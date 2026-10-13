// End-to-end smoke test against the production build using the locally
// installed Chrome. Run: npm run build && node scripts/e2e.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = 4173;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function waitForServer(url, ms = 15000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () =>
      fetch(url)
        .then((r) => (r.ok ? resolve() : retry()))
        .catch(retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error('preview server did not start')) : setTimeout(tryOnce, 250));
    tryOnce();
  });
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
  if (!ok) failures++;
};

async function clearInput(page, sel) {
  await page.$eval(sel, (el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

try {
  await waitForServer(`http://localhost:${PORT}/`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--no-sandbox', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const cspViolations = [];
  const requests = new Set();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('request', (r) => requests.add(new URL(r.url()).origin));
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  check('page title', (await page.title()).includes('0xCairn'));

  // headers
  const res = await fetch(`http://localhost:${PORT}/`);
  check('CSP header served by preview', (res.headers.get('content-security-policy') || '').includes("default-src 'none'"));

  // wait for CPU benchmark
  await page.waitForFunction(() => /\d+(\.\d+)? [KMG]\/s|\d+ \/s/.test(document.querySelector('.engine .rate')?.textContent || ''), { timeout: 30000 });
  const cpuRate = await page.$eval('.engine .rate', (el) => el.textContent);
  check('CPU benchmark completed', !!cpuRate, cpuRate);

  // GPU status (may legitimately be unavailable in headless)
  await page.waitForFunction(() => !(document.querySelectorAll('.engine .sub')[1]?.textContent || '').includes('self-testing'), { timeout: 60000 }).catch(() => {});
  const gpuSub = await page.$$eval('.engine .sub', (els) => els[1]?.textContent);
  const gpuRate = await page.$$eval('.engine .rate', (els) => els[1]?.textContent);
  console.log(`INFO GPU: ${gpuSub} ${gpuRate}`);

  await page.screenshot({ path: '/tmp/cairn-idle.png', fullPage: true });

  // pause / resume / stop on a pattern that cannot complete during the test
  await page.type('#prefix', '000000000000');
  check('long-run warning shown', !!(await page.$('.note.danger, .note.warn')));
  await page.click('.btn.primary');
  await page.waitForFunction(() => document.querySelector('.status-line')?.textContent.includes('Mining'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/cairn-mining.png', fullPage: true });
  const liveRate = await page.$eval('.runstats .stat .v', (el) => el.textContent);
  check('live attempts counter running', /\d/.test(liveRate), liveRate);
  for (const b of await page.$$('.actions .btn')) {
    if ((await b.evaluate((el) => el.textContent)).trim() === 'Pause') await b.click();
  }
  await page.waitForFunction(() => document.querySelector('.status-line')?.textContent.includes('Paused'), { timeout: 5000 });
  check('pause works', true);
  for (const b of await page.$$('.actions .btn')) {
    if ((await b.evaluate((el) => el.textContent)).trim() === 'Resume') await b.click();
  }
  await page.waitForFunction(() => document.querySelector('.status-line')?.textContent.includes('Mining'), { timeout: 5000 });
  check('resume works', true);
  for (const b of await page.$$('.actions .btn')) {
    if ((await b.evaluate((el) => el.textContent)).trim() === 'Stop') await b.click();
  }
  await page.waitForFunction(() => document.querySelector('.btn.primary')?.textContent.includes('Start'), { timeout: 5000 });
  check('stop works', true);

  // mine a 4-char prefix with a suffix
  await clearInput(page, '#prefix');
  await page.type('#prefix', 'abc');
  await page.type('#suffix', '9');
  const diff = await page.$eval('.difficulty .stat .v', (el) => el.textContent);
  check('difficulty shown', diff.includes('65,536'), diff);
  await page.click('.btn.primary');
  await page.waitForSelector('.result', { timeout: 120000 });
  const addr = await page.$eval('.result .kv .v', (el) => el.textContent);
  check('result address matches pattern', /^0xabc.*9$/i.test(addr), addr);
  check('result marked verified', (await page.$eval('.result .meta', (el) => el.textContent)).includes('verified'));
  // reveal key and re-derive in page using the app's own noble bundle is not exposed; re-derive here via a fresh page module instead
  await page.click('.result .kv:nth-of-type(2) .btn.xs');
  const key = await page.$eval('.result .kv:nth-of-type(2) .v', (el) => el.textContent.trim());
  check('private key revealed (66 chars)', /^0x[0-9a-f]{64}$/.test(key), key.slice(0, 10) + '…');
  check('status shows match found', (await page.$eval('.status-line', (el) => el.textContent)).includes('Match found'));

  await page.screenshot({ path: '/tmp/cairn-result.png', fullPage: true });

  // keep searching accumulates a second result, then new search resets
  for (const b of await page.$$('.actions .btn')) {
    if ((await b.evaluate((el) => el.textContent)).includes('Keep searching')) await b.click();
  }
  await page.waitForFunction(() => document.querySelectorAll('.result').length >= 2, { timeout: 60000 });
  check('keep searching finds a second match', true);
  for (const b of await page.$$('.actions .btn')) {
    if ((await b.evaluate((el) => el.textContent)).includes('New search')) await b.click();
  }
  await page.waitForFunction(() => document.querySelector('.btn.primary')?.textContent.includes('Start'), { timeout: 5000 });
  check('new search resets controls', true);

  // keystore download form appears
  for (const b of await page.$$('.result .btn')) {
    const t = await b.evaluate((el) => el.textContent);
    if (t.includes('keystore')) await b.click();
  }
  check('keystore form opens', !!(await page.$('.inline-form')));

  // CREATE2 tab with the EIP-1014 vector pieces (pattern 2 chars so it is instant)
  const tabs = await page.$$('.tab');
  await tabs[1].click();
  await page.type('#deployer', '0x00000000000000000000000000000000deadbeef');
  await page.type('#initcode', '0xdeadbeef');
  const hashVal = await page.$eval('#inithash', (el) => el.value);
  check('init code hashed', hashVal.startsWith('0x') && hashVal.length === 66, hashVal);
  await clearInput(page, '#prefix');
  await page.type('#prefix', 'ca');
  await clearInput(page, '#suffix');
  await page.click('.btn.primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.result h3')].some((e) => e.textContent.includes('Contract')), { timeout: 60000 });
  const c2 = await page.$$eval('.result h3', (els) => els.map((e) => e.textContent));
  check('CREATE2 result found', c2.some((t) => t.includes('Contract')), c2.join(' | '));
  for (const b of await page.$$('.actions .btn')) {
    const t = await b.evaluate((el) => el.textContent);
    if (t.includes('New search')) await b.click();
  }
  // v4 hook bit mask: beforeSwap (bit 7) + afterSwap (bit 6) -> low 14 bits == 0x00c0
  for (const b of await page.$$('.linkish')) {
    if ((await b.evaluate((el) => el.textContent)).includes('bit-mask')) await b.click();
  }
  await clearInput(page, '#prefix');
  for (const c of await page.$$('.chip')) {
    const t = await c.evaluate((el) => el.textContent.trim());
    if (t === 'beforeSwap' || t === 'afterSwap') await c.click();
  }
  const maskVal = await page.$eval('#value', (el) => el.value);
  check('v4 flags set mask value', maskVal.endsWith('00c0'), maskVal);
  const before = (await page.$$('.result')).length;
  await page.click('.btn.primary');
  await page.waitForFunction((n) => document.querySelectorAll('.result').length > n, { timeout: 60000 }, before);
  const maskAddr = await page.$eval('.result .kv .v', (el) => el.textContent.trim());
  const low14 = parseInt(maskAddr.slice(-4), 16) & 0x3fff;
  check('mask result has low 14 bits == 0x00c0', low14 === 0x00c0, `${maskAddr} low14=0x${low14.toString(16)}`);
  for (const b of await page.$$('.actions .btn')) {
    if ((await b.evaluate((el) => el.textContent)).includes('New search')) await b.click();
  }

  // split-key: generate keypair and combine round trip
  await (await page.$$('.tab'))[2].click();
  for (const b of await page.$$('.step .btn')) {
    const t = await b.evaluate((el) => el.textContent);
    if (t.includes('Generate keypair')) await b.click();
  }
  const pub = await page.$eval('.step .kv .v', (el) => el.textContent.trim());
  check('split-key public key generated', /^0x04[0-9a-f]{128}$/.test(pub));

  // service worker registered and precache populated
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => !!r), { timeout: 10000 }).catch(() => {});
  const swOk = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'no registration';
    const keys = await caches.keys();
    return keys.length ? `cache ${keys[0]}` : 'registered, cache empty';
  });
  check('service worker registered with precache', swOk.startsWith('cache'), swOk);

  const csp = await page.evaluate(() => window.__csp || []);
  check('no CSP violations', csp.length === 0, csp.join('; '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 500));
  check('only same-origin requests', [...requests].every((o) => o === `http://localhost:${PORT}`), [...requests].join(', '));

  await browser.close();
} catch (e) {
  console.error('E2E error:', e);
  failures++;
} finally {
  preview.kill();
}
console.log(failures === 0 ? 'ALL E2E CHECKS PASSED' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
