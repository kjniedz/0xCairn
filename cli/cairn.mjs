#!/usr/bin/env node
/**
 * cairn: tiny CLI for the Cairn Teams API.
 *
 *   CAIRN_API_KEY=... node cli/cairn.mjs quote --prefix 0000
 *   CAIRN_API_KEY=... node cli/cairn.mjs create2 --deployer 0x… --init-code-hash 0x… --prefix 0000 [--suffix …] [--mask … --value …] [--pay-asset USDC|ETH|BTC] [--wait]
 *   CAIRN_API_KEY=... node cli/cairn.mjs status <token> [--wait]
 *
 * Prints JSON so it can be piped into a deploy script. Exit code 0 when a salt
 * is printed, 1 on error, 2 on usage.
 */
const API = (process.env.CAIRN_API ?? 'https://0xcairn.kyleniedz99.workers.dev').replace(/\/$/, '');
const KEY = process.env.CAIRN_API_KEY ?? '';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[k] = next;
        i++;
      } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

async function call(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

async function waitFor(token) {
  for (;;) {
    const j = await call(`/api/v1/jobs/${token}`);
    if (j.status === 'found') return j;
    if (['expired', 'cancelled', 'refunded'].includes(j.status)) throw new Error(`job ${j.status}`);
    process.stderr.write(`${j.status}${j.progress?.attempts ? ` · ${(j.progress.attempts / 1e9).toFixed(2)}G attempts` : ''}\n`);
    await new Promise((r) => setTimeout(r, 20000));
  }
}

const args = parse(process.argv.slice(2));
const cmd = args._[0];
try {
  if (!KEY && cmd !== 'help') throw new Error('set CAIRN_API_KEY');
  if (cmd === 'quote') {
    const q = new URLSearchParams();
    for (const k of ['prefix', 'suffix', 'mask', 'value']) if (args[k]) q.set(k, String(args[k]));
    if (args.caseSensitive) q.set('caseSensitive', '1');
    console.log(JSON.stringify(await call(`/api/v1/quote?${q}`), null, 2));
  } else if (cmd === 'create2') {
    if (!args.deployer || !args.initCodeHash) throw Object.assign(new Error('--deployer and --init-code-hash are required'), { usage: true });
    const job = await call('/api/v1/jobs', {
      deployer: args.deployer,
      initCodeHash: args.initCodeHash,
      prefix: args.prefix ?? '',
      suffix: args.suffix ?? '',
      caseSensitive: !!args.caseSensitive,
      mask: args.mask,
      value: args.value,
      payAsset: args.payAsset ?? 'USDC',
    });
    if (job.payment) process.stderr.write(`pay ${job.payment.amount} ${job.payment.asset} on ${job.payment.chain} to ${job.payment.address}\n`);
    process.stderr.write(`order ${job.url}\n`);
    const final = args.wait ? await waitFor(job.token) : job;
    console.log(JSON.stringify(final.result ? { token: final.token, salt: '0x' + final.result.hex, address: final.result.address } : final, null, 2));
  } else if (cmd === 'status') {
    const token = args._[1];
    if (!token) throw Object.assign(new Error('token required'), { usage: true });
    const j = args.wait ? await waitFor(token) : await call(`/api/v1/jobs/${token}`);
    console.log(JSON.stringify(j, null, 2));
  } else {
    console.log('usage: cairn quote|create2|status  (see header of this file)');
    process.exit(cmd === 'help' ? 0 : 2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(e.usage ? 2 : 1);
}
