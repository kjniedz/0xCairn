/**
 * Programmatic SEO pages, generated at build time into dist/. Pure static
 * HTML with one stylesheet and no scripts, each linking into the generator
 * with the pattern prefilled. Also rewrites sitemap.xml to include them.
 *
 *   /vanity/<pattern>/              popular patterns: what, difficulty, ETA, "mine this"
 *   /hexspeak/<word>/               valid hex spellings of common words and names
 *   /difficulty/<n>-characters/     expected attempts and realistic times per length
 *   /guides/<slug>/                 long-form guides
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { HEXSPEAK_UNIQUE } from '../src/content/hexspeak.ts';
import { GUIDES } from '../src/content/guides.ts';
import { SITE } from '../src/site.ts';

const LAPTOP_RATE = 20e6; // keys/s, a typical 8-core laptop with WASM workers
const GPU_RATE = 400e6; // one dedicated rig

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtBig(n: number): string {
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)}${units[i]}`;
}

function fmtDur(s: number): string {
  if (s < 1) return 'under a second';
  const u: [string, number][] = [
    ['year', 31536000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  if (s > 1000 * 31536000) return `${fmtBig(s / 31536000)} years`;
  for (const [n, size] of u) {
    if (s >= size) {
      const v = s / size;
      const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      return `${r} ${n}${r === 1 ? '' : 's'}`;
    }
  }
  return 'under a second';
}

function page(opts: { title: string; description: string; canonical: string; body: string; breadcrumb?: Array<[string, string]> }): string {
  const bc = opts.breadcrumb ?? [];
  const ld = bc.length
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [['0xCairn', '/'], ...bc].map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE.url + url })),
      })}</script>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'">
<title>${esc(opts.title)} | 0xCairn</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${SITE.url}${opts.canonical}">
<meta name="theme-color" content="#0f0e0c"><meta name="color-scheme" content="dark light"><meta name="referrer" content="no-referrer">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}"><meta property="og:image" content="${SITE.url}/og.png"><meta property="og:type" content="article">
<link rel="stylesheet" href="/seo.css">
${ld}
</head>
<body>
<div class="bm-strip"></div>
<div class="wrap">
<header class="header"><a class="brand" href="/"><span class="brand-name">0x<span>Cairn</span></span></a><nav class="header-links"><a href="/">Generator</a><a href="/pro/">Pro</a><a href="/teams/">Teams</a><a href="/guides/">Guides</a></nav></header>
<main class="doc">
${bc.length ? `<nav class="crumbs">${['<a href="/">0xCairn</a>', ...bc.map(([n, u]) => `<a href="${u}">${esc(n)}</a>`)].join(' / ')}</nav>` : ''}
${opts.body}
</main>
<footer class="footer"><span>A Black Mountain product · <a href="${SITE.repo}" rel="noopener">source</a> · <a href="/privacy/">privacy</a> · <a href="/terms/">terms</a></span><span class="mono">no servers · no analytics · no cookies · works offline</span></footer>
</div>
</body>
</html>
`;
}

function mineLink(prefix: string, suffix: string, label = 'Mine this address free'): string {
  const q = new URLSearchParams();
  if (prefix) q.set('prefix', prefix);
  if (suffix) q.set('suffix', suffix);
  return `<a class="btn" href="/?${q.toString()}">${esc(label)}</a>`;
}

function vanityPage(prefix: string, suffix: string, word?: string, note?: string): { url: string; html: string } {
  const pat = prefix || suffix;
  const n = prefix.length + suffix.length;
  const diff = Math.pow(16, n);
  const display = prefix ? `0x${prefix}…` : `…${suffix}`;
  const url = `/vanity/${pat}/`;
  const title = `${display} vanity Ethereum address: difficulty, mining time and how to get one`;
  const description = `Mine a ${display} vanity Ethereum address in your browser. ${n} fixed characters means 1 in ${fmtBig(diff)} attempts, about ${fmtDur(diff / LAPTOP_RATE)} on a laptop. Works on every EVM chain.`;
  const body = `
<p class="eyebrow">Vanity pattern</p>
<h1><span class="mono">${esc(display)}</span></h1>
<p class="lead">${word ? `"${esc(word)}" spelled in hex. ` : ''}${note ? esc(note) + ' ' : ''}A ${n}-character pattern is a 1 in ${fmtBig(diff)} search: about ${fmtDur(diff / LAPTOP_RATE)} on a typical laptop with 0xCairn, ${fmtDur(diff / GPU_RATE)} on one dedicated GPU.</p>
<p>${mineLink(prefix, suffix)}</p>
<table class="facts"><tbody>
<tr><th>Fixed characters</th><td class="mono">${n}</td></tr>
<tr><th>Expected attempts</th><td class="mono">${fmtBig(diff)} (16<sup>${n}</sup>)</td></tr>
<tr><th>50% chance within</th><td>${fmtDur((diff * Math.LN2) / LAPTOP_RATE)} on a laptop</td></tr>
<tr><th>90% chance within</th><td>${fmtDur((diff * Math.log(10)) / LAPTOP_RATE)} on a laptop</td></tr>
<tr><th>Case-sensitive (EIP-55)</th><td>${(pat.match(/[a-f]/g) ?? []).length ? `${Math.pow(2, (pat.match(/[a-f]/g) ?? []).length)}× harder with checksum casing` : 'digits only, no extra cost'}</td></tr>
<tr><th>Chains</th><td>Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, zkSync, Scroll, Linea, Gnosis and every EVM network</td></tr>
</tbody></table>
<h2>How ${esc(display)} is mined</h2>
<p>0xCairn generates random 256-bit private keys, derives each address with secp256k1 and keccak256 inside a WebAssembly kernel on every CPU core (plus WebGPU when available), and stops at the first address that ${prefix ? `starts with ${esc(prefix)}` : `ends with ${esc(suffix)}`}. Every match is re-verified with an independent implementation before it is shown. Nothing leaves your browser, and the page keeps working offline.</p>
<h2>Is it safe?</h2>
<p>A vanity address is exactly as secure as a random one as long as the generator seeds its search with full 256-bit randomness. 0xCairn does. <a href="/guides/is-it-safe/">Read the safety guide</a> and <a href="/guides/profanity-exploit/">what went wrong with Profanity</a>.</p>
<p>${mineLink(prefix, suffix)}</p>
<h2>Related</h2>
<ul class="links">${['c0ffee', 'dead', 'beef', '0000', 'babe', '5afe', 'cafe', '1337'].filter((x) => x !== pat).map((x) => `<li><a href="/vanity/${x}/">0x${x}…</a></li>`).join('')}<li><a href="/difficulty/${n}-characters/">All ${n}-character patterns</a></li></ul>`;
  return { url, html: page({ title, description, canonical: url, body, breadcrumb: [['Vanity patterns', '/vanity/'], [display, url]] }) };
}

function hexspeakPage(word: string, hex: string, note?: string): { url: string; html: string } {
  const url = `/hexspeak/${word}/`;
  const n = hex.length;
  const diff = Math.pow(16, n);
  const title = `"${word}" in hex: ${hex} vanity address spelling`;
  const description = `How to spell "${word}" in an Ethereum address: 0x${hex}. ${n} characters, 1 in ${fmtBig(diff)} attempts, about ${fmtDur(diff / LAPTOP_RATE)} to mine on a laptop with 0xCairn.`;
  const subs = [...word].map((ch, i) => (ch !== hex[i] && hex[i] ? `${ch}→${hex[i]}` : null)).filter(Boolean);
  const body = `
<p class="eyebrow">Hexspeak</p>
<h1>"${esc(word)}" in hex is <span class="mono">0x${esc(hex)}</span></h1>
<p class="lead">${note ? esc(note) + ' ' : ''}Ethereum addresses only contain 0-9 and a-f, so words are spelled with look-alike digits${subs.length ? ` (${subs.join(', ')})` : ''}. As a prefix, <span class="mono">0x${esc(hex)}</span> is a ${n}-character pattern: 1 in ${fmtBig(diff)}, about ${fmtDur(diff / LAPTOP_RATE)} on a laptop.</p>
<p>${mineLink(hex, '', `Mine 0x${hex}… free`)} ${mineLink('', hex, `…${hex} as a suffix`)}</p>
<h2>Shorter and longer options</h2>
<ul class="links">
${hex.length > 3 ? `<li><a href="/vanity/${hex.slice(0, 3)}/">0x${hex.slice(0, 3)}…</a> (3 characters, instant)</li>` : ''}
<li><a href="/vanity/${hex}/">0x${hex}…</a> (${n} characters)</li>
<li><a href="/difficulty/${n}-characters/">How long ${n}-character patterns take</a></li>
</ul>
<h2>Other hexspeak words</h2>
<ul class="links cols">${HEXSPEAK_UNIQUE.filter((h) => h.word !== word)
    .slice(0, 40)
    .map((h) => `<li><a href="/hexspeak/${h.word}/">${esc(h.word)} <span class="mono">${esc(h.hex)}</span></a></li>`)
    .join('')}</ul>
<p>Don't see your word? The generator's <a href="/">"find a word"</a> helper suggests hex spellings for any name.</p>`;
  return { url, html: page({ title, description, canonical: url, body, breadcrumb: [['Hexspeak', '/hexspeak/'], [word, url]] }) };
}

function difficultyPage(n: number): { url: string; html: string } {
  const url = `/difficulty/${n}-characters/`;
  const diff = Math.pow(16, n);
  const title = `${n}-character vanity address: expected attempts and mining time`;
  const description = `A ${n}-character Ethereum vanity address pattern takes 1 in ${fmtBig(diff)} attempts: about ${fmtDur(diff / LAPTOP_RATE)} on a laptop, ${fmtDur(diff / GPU_RATE)} on a dedicated GPU. Case-sensitive and probability tables.`;
  const rows = [0.5, 0.9, 0.99].map((p) => {
    const a = -Math.log(1 - p) * diff;
    return `<tr><td>${Math.round(p * 100)}%</td><td class="mono">${fmtBig(a)}</td><td>${fmtDur(a / 2e6)}</td><td>${fmtDur(a / LAPTOP_RATE)}</td><td>${fmtDur(a / GPU_RATE)}</td></tr>`;
  });
  const cs = [0, 1, 2, 3, 4, Math.min(n, 6)].filter((v, i, arr) => v <= n && arr.indexOf(v) === i);
  const body = `
<p class="eyebrow">Difficulty</p>
<h1>${n}-character vanity addresses</h1>
<p class="lead">Every fixed hex character multiplies the work by 16, so a ${n}-character prefix or suffix (or any split between them) is a 1 in ${fmtBig(diff)} search. Mining has no memory: each attempt is an independent shot, so these are probabilities, not deadlines.</p>
<p>${mineLink('0'.repeat(Math.min(n, 12)), '', `Mine a ${n}-character pattern`)}</p>
<h2>Time to a match</h2>
<table class="facts"><thead><tr><th>Chance of a match</th><th>Attempts</th><th>1 core</th><th>Laptop (8 cores)</th><th>Dedicated GPU</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<p class="small">Assumes 2M keys/s per core, 20M/s for a laptop running 0xCairn's WebAssembly workers, and 400M/s for one rented GPU rig running Cairn Pro.</p>
<h2>Case-sensitive patterns</h2>
<p>With EIP-55 checksum matching, each letter (a-f) in the pattern doubles the work; digits cost nothing extra.</p>
<table class="facts"><thead><tr><th>Letters in pattern</th><th>Expected attempts</th><th>Laptop</th></tr></thead><tbody>${cs.map((L) => `<tr><td>${L}</td><td class="mono">${fmtBig(diff * Math.pow(2, L))}</td><td>${fmtDur((diff * Math.pow(2, L)) / LAPTOP_RATE)}</td></tr>`).join('')}</tbody></table>
<h2>Other lengths</h2>
<ul class="links">${[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((x) => x !== n).map((x) => `<li><a href="/difficulty/${x}-characters/">${x} characters</a></li>`).join('')}</ul>
${n >= 8 ? `<p>Patterns this long are what <a href="/pro/">Cairn Pro</a> is for: dedicated GPUs with split-key mining, so we still never see your key.</p>` : ''}`;
  return { url, html: page({ title, description, canonical: url, body, breadcrumb: [['Difficulty', '/difficulty/'], [`${n} characters`, url]] }) };
}

function guidePage(g: (typeof GUIDES)[number]): { url: string; html: string } {
  const url = `/guides/${g.slug}/`;
  const body = `
<p class="eyebrow">Guide</p>
<h1>${esc(g.title)}</h1>
${g.body
    .map((b) => {
      if (typeof b === 'string') return `<p>${esc(b)}</p>`;
      if ('h' in b) return `<h2>${esc(b.h)}</h2>`;
      return `<ul>${b.li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    })
    .join('\n')}
<p>${mineLink('', '', 'Open the generator')}</p>
<h2>More guides</h2>
<ul class="links">${GUIDES.filter((x) => x.slug !== g.slug).map((x) => `<li><a href="/guides/${x.slug}/">${esc(x.title)}</a></li>`).join('')}</ul>`;
  return { url, html: page({ title: g.title, description: g.description, canonical: url, body, breadcrumb: [['Guides', '/guides/'], [g.title, url]] }) };
}

function indexPage(kind: 'vanity' | 'hexspeak' | 'difficulty' | 'guides', items: Array<[string, string, string?]>): { url: string; html: string } {
  const titles = { vanity: 'Popular vanity address patterns', hexspeak: 'Hexspeak dictionary: words you can spell in an Ethereum address', difficulty: 'Vanity address difficulty by length', guides: 'Guides to vanity addresses' };
  const descs = {
    vanity: 'Difficulty and mining time for the most popular Ethereum vanity address prefixes and suffixes, with one-click mining in your browser.',
    hexspeak: 'Every word and name that can be spelled with 0-9 and a-f, with the hex spelling and how long it takes to mine as an address.',
    difficulty: 'Expected attempts and realistic mining times for vanity address patterns from 3 to 12 characters, case-sensitive and not.',
    guides: 'What a vanity address is, whether it is safe, the Profanity exploit, CREATE2 contract addresses and Uniswap v4 hook mining.',
  };
  const url = `/${kind}/`;
  const body = `<p class="eyebrow">${kind}</p><h1>${esc(titles[kind])}</h1><p class="lead">${esc(descs[kind])}</p><ul class="links ${kind === 'hexspeak' ? 'cols' : ''}">${items.map(([label, href, extra]) => `<li><a href="${href}">${esc(label)}</a>${extra ? ` <span class="small">${esc(extra)}</span>` : ''}</li>`).join('')}</ul>`;
  return { url, html: page({ title: titles[kind], description: descs[kind], canonical: url, body, breadcrumb: [[titles[kind], url]] }) };
}

export function seoPages(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'cairn-seo',
    apply: 'build',
    enforce: 'pre',
    configResolved(c) {
      outDir = c.build.outDir;
      root = c.root;
    },
    closeBundle() {
      const dist = path.resolve(root, outDir);
      const pages: Array<{ url: string; html: string }> = [];
      const vanity: Array<[string, string, string]> = [];
      const popular = ['c0ffee', 'dead', 'beef', '0000', '00000', '000000', 'babe', 'cafe', '5afe', '1337', 'face', 'fade', 'feed', 'deadbeef', 'ba5e', 'b00b', 'd09e', 'add', 'bad', 'ace', 'c0de', 'da0', 'def1', 'b055', 'f00d'];
      const words = new Map(HEXSPEAK_UNIQUE.map((h) => [h.hex, h]));
      for (const p of popular) {
        const w = words.get(p);
        const pg = vanityPage(p, '', w?.word, w?.note);
        pages.push(pg);
        vanity.push([`0x${p}…`, pg.url, `${p.length} characters`]);
      }
      for (const s of ['dead', 'beef', 'babe', 'c0ffee', '0000']) {
        const pg = vanityPage('', s);
        pages.push({ ...pg, url: `/vanity/suffix-${s}/` });
        vanity.push([`…${s}`, `/vanity/suffix-${s}/`, 'suffix']);
      }
      pages.push(indexPage('vanity', vanity));
      const hx: Array<[string, string, string]> = [];
      for (const h of HEXSPEAK_UNIQUE) {
        const pg = hexspeakPage(h.word, h.hex, h.note);
        pages.push(pg);
        hx.push([h.word, pg.url, h.hex]);
      }
      pages.push(indexPage('hexspeak', hx));
      const dl: Array<[string, string]> = [];
      for (let n = 3; n <= 12; n++) {
        const pg = difficultyPage(n);
        pages.push(pg);
        dl.push([`${n} characters`, pg.url]);
      }
      pages.push(indexPage('difficulty', dl));
      const gl: Array<[string, string]> = [];
      for (const g of GUIDES) {
        const pg = guidePage(g);
        pages.push(pg);
        gl.push([g.title, pg.url]);
      }
      pages.push(indexPage('guides', gl));

      for (const pg of pages) {
        const dir = path.join(dist, pg.url);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), pg.html);
      }
      const urls = ['/', '/pro/', '/teams/', '/privacy/', '/terms/', ...pages.map((p) => p.url)];
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE.url}${u}</loc><changefreq>${u === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${u === '/' ? '1.0' : u.startsWith('/guides') || u === '/pro/' || u === '/teams/' ? '0.8' : '0.6'}</priority></url>`).join('\n')}\n</urlset>\n`;
      fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);
      console.log(`[cairn-seo] wrote ${pages.length} static pages + sitemap`);
    },
  };
}
