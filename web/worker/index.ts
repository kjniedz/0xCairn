/**
 * 0xCairn API Worker. Serves /api/* only; everything else is static assets
 * handled by Cloudflare before this code runs (assets.run_worker_first).
 *
 * Privacy: stores only what fulfilling an order needs (see schema.sql). No
 * request logging, no IPs, no analytics. Never any private key material: Pro
 * jobs receive a public key and return an offset; CREATE2 salts are public.
 */
import { Hono } from 'hono';
import { HDKey } from '@scure/bip32';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { quoteForDifficulty, maskDifficulty, PRO } from '../src/lib/pricing';
import { difficulty as patternDifficulty, matchesPattern, validatePattern, type Pattern } from '../src/lib/pattern';
import { splitKeyAddress, create2Address, toChecksum, isValidPublicKey, isAddress, isBytes32Hex, strip0x } from '../src/lib/eth';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { btcAmountSats, satsToBtcString, btcStringToSats, matchBtcTx, type BtcTx } from '../src/lib/btc';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_URL: string;
  RPC_ETH: string;
  RPC_BASE: string;
  USDC_BASE: string;
  BTC_ADDRESS?: string;
  BTC_API: string;
  PAYMENT_XPUB?: string;
  WORKER_TOKEN?: string;
  ADMIN_TOKEN?: string;
}

type OrderRow = {
  id: number;
  token: string;
  kind: 'split' | 'create2' | 'sharecard';
  status: string;
  created_at: number;
  paid_at: number | null;
  started_at: number | null;
  found_at: number | null;
  expires_at: number | null;
  prefix: string;
  suffix: string;
  case_sensitive: number;
  mask_hex: string | null;
  value_hex: string | null;
  public_key: string | null;
  deployer: string | null;
  init_code_hash: string | null;
  difficulty: number;
  expected_seconds: number;
  quote_usd: number;
  pay_asset: string | null;
  pay_chain: string | null;
  pay_amount: string | null;
  pay_address: string | null;
  pay_index: number | null;
  eth_usd: number | null;
  email: string | null;
  api_key_id: number | null;
  attempts: number;
  rate: number;
  lease_at: number | null;
  worker_id: string | null;
  result_hex: string | null;
  result_address: string | null;
  refund_requested_at: number | null;
  refund_address: string | null;
  pay_txid: string | null;
};

const app = new Hono<{ Bindings: Env }>();
const now = () => Math.floor(Date.now() / 1000);
const LEASE_SECONDS = 600;
const parseAsset = (v: unknown): 'USDC' | 'ETH' | 'BTC' => (v === 'ETH' ? 'ETH' : v === 'BTC' ? 'BTC' : 'USDC');

function randomToken(bytes = 24): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(d));
}

function bad(c: { json: (o: unknown, s?: number) => Response }, message: string, status = 400): Response {
  return c.json({ error: message }, status as 400);
}

// ---------------------------------------------------------------------------
// Targets: prefix/suffix patterns and bit masks
// ---------------------------------------------------------------------------

interface Target {
  pattern: Pattern;
  maskHex: string | null;
  valueHex: string | null;
}

function parseTarget(body: Record<string, unknown>): { target: Target; difficulty: number } | string {
  const prefix = String(body.prefix ?? '').replace(/^0x/i, '');
  const suffix = String(body.suffix ?? '');
  const caseSensitive = body.caseSensitive === true || body.caseSensitive === 1 || body.cs === '1';
  const maskHex = body.mask ? strip0x(String(body.mask)).toLowerCase() : null;
  const valueHex = body.value ? strip0x(String(body.value)).toLowerCase() : null;
  const pattern: Pattern = { prefix, suffix, caseSensitive };
  const hasPattern = prefix.length + suffix.length > 0;
  if (hasPattern) {
    const err = validatePattern(pattern);
    if (err) return err;
  }
  let diff = hasPattern ? patternDifficulty(pattern) : 1;
  if (maskHex || valueHex) {
    if (!maskHex || !valueHex || !/^[0-9a-f]{40}$/.test(maskHex) || !/^[0-9a-f]{40}$/.test(valueHex)) {
      return 'mask and value must both be 40 hex characters';
    }
    diff *= maskDifficulty(maskHex);
  }
  if (!hasPattern && !maskHex) return 'provide a prefix, a suffix, or a bit mask';
  if (diff < 2) return 'target is trivial; mine it in the browser for free';
  return { target: { pattern, maskHex, valueHex }, difficulty: diff };
}

function maskMatches(addressHex: string, maskHex: string | null, valueHex: string | null): boolean {
  if (!maskHex || !valueHex) return true;
  const a = hexToBytes(addressHex);
  const m = hexToBytes(maskHex);
  const v = hexToBytes(valueHex);
  for (let i = 0; i < 20; i++) if ((a[i] & m[i]) !== (v[i] & m[i])) return false;
  return true;
}

function targetMatches(addressLower: string, row: OrderRow): boolean {
  const p: Pattern = { prefix: row.prefix, suffix: row.suffix, caseSensitive: row.case_sensitive === 1 };
  if (p.prefix.length + p.suffix.length > 0 && !matchesPattern(addressLower, toChecksum(addressLower), p)) return false;
  return maskMatches(addressLower, row.mask_hex, row.value_hex);
}

// ---------------------------------------------------------------------------
// Payments: per-order deposit address from an xpub (server never holds keys)
// ---------------------------------------------------------------------------

function depositAddress(xpub: string, index: number): string {
  const hd = HDKey.fromExtendedKey(xpub).deriveChild(index);
  if (!hd.publicKey) throw new Error('xpub derivation failed');
  const unc = secp256k1.Point.fromBytes(hd.publicKey).toBytes(false);
  return bytesToHex(keccak_256(unc.subarray(1)).subarray(12));
}

async function spotUsd(pair: 'ETH-USD' | 'BTC-USD'): Promise<number> {
  const r = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('price feed unavailable');
  const j = (await r.json()) as { data: { amount: string } };
  const v = Number(j.data.amount);
  if (!isFinite(v) || v <= 0) throw new Error('bad price');
  return v;
}
const ethUsd = () => spotUsd('ETH-USD');
const btcUsd = () => spotUsd('BTC-USD');

/** Scan recent transactions to the shared BTC address for an exact-amount, confirmed, unused payment. */
async function btcPaidTxid(env: Env, row: OrderRow): Promise<string | null> {
  if (!env.BTC_ADDRESS || !row.pay_amount) return null;
  const r = await fetch(`${env.BTC_API}/address/${env.BTC_ADDRESS}/txs`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('btc api unavailable');
  const txs = (await r.json()) as BtcTx[];
  const { results } = await env.DB.prepare('SELECT pay_txid FROM orders WHERE pay_txid IS NOT NULL').all<{ pay_txid: string }>();
  const used = new Set(results.map((x) => x.pay_txid));
  return matchBtcTx(txs, env.BTC_ADDRESS, btcStringToSats(row.pay_amount), used, true);
}

/** Returns true (and records the txid / marks queued) when an order's payment has landed. */
async function settleIfPaid(env: Env, row: OrderRow): Promise<boolean> {
  if (row.pay_asset === 'BTC') {
    const txid = await btcPaidTxid(env, row);
    if (!txid) return false;
    const r = await env.DB.prepare("UPDATE orders SET status = 'queued', paid_at = ?, pay_txid = ? WHERE id = ? AND status = 'awaiting_payment'").bind(now(), txid, row.id).run();
    return !!r.meta.changes;
  }
  const have = await paidAmount(env, row);
  if (have < (requiredUnits(row) * 99n) / 100n) return false;
  const r = await env.DB.prepare("UPDATE orders SET status = 'queued', paid_at = ? WHERE id = ? AND status = 'awaiting_payment'").bind(now(), row.id).run();
  return !!r.meta.changes;
}

async function rpc(url: string, method: string, params: unknown[]): Promise<string> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: string; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result ?? '0x0';
}

async function paidAmount(env: Env, row: OrderRow): Promise<bigint> {
  if (!row.pay_address) return 0n;
  if (row.pay_asset === 'ETH') {
    return BigInt(await rpc(env.RPC_ETH, 'eth_getBalance', ['0x' + row.pay_address, 'latest']));
  }
  // USDC balanceOf(address) on Base
  const data = '0x70a08231' + row.pay_address.padStart(64, '0');
  return BigInt(await rpc(env.RPC_BASE, 'eth_call', [{ to: env.USDC_BASE, data }, 'latest']));
}

function requiredUnits(row: OrderRow): bigint {
  const [whole, frac = ''] = (row.pay_amount ?? '0').split('.');
  const decimals = row.pay_asset === 'ETH' ? 18 : row.pay_asset === 'BTC' ? 8 : 6;
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

async function checkPayments(env: Env): Promise<number> {
  const t = now();
  const { results } = await env.DB.prepare("SELECT * FROM orders WHERE status = 'awaiting_payment' ORDER BY created_at ASC LIMIT 50").all<OrderRow>();
  let paid = 0;
  for (const row of results) {
    if (row.expires_at && row.expires_at < t) {
      await env.DB.prepare("UPDATE orders SET status = 'expired' WHERE id = ?").bind(row.id).run();
      continue;
    }
    try {
      if (await settleIfPaid(env, row)) paid++;
    } catch {
      // RPC hiccup; try again next run
    }
  }
  // reclaim stale leases
  await env.DB.prepare("UPDATE orders SET status = 'queued', worker_id = NULL WHERE status = 'mining' AND lease_at < ?").bind(t - LEASE_SECONDS).run();
  return paid;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => c.json({ ok: true, payments: !!c.env.PAYMENT_XPUB || !!c.env.BTC_ADDRESS, evm: !!c.env.PAYMENT_XPUB, btc: !!c.env.BTC_ADDRESS, workers: !!c.env.WORKER_TOKEN }));

app.get('/api/quote', (c) => {
  const q = c.req.query();
  const parsed = parseTarget(q);
  if (typeof parsed === 'string') return bad(c, parsed);
  const quote = quoteForDifficulty(parsed.difficulty);
  return c.json({ quote, policy: { refundMultiple: PRO.refundMultiple, quoteValidMinutes: PRO.quoteValidMinutes, paymentWindowHours: PRO.paymentWindowHours } });
});

function publicOrder(row: OrderRow, siteUrl: string) {
  const t = now();
  const running = row.started_at ? (row.found_at ?? t) - row.started_at : 0;
  return {
    token: row.token,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    startedAt: row.started_at,
    foundAt: row.found_at,
    expiresAt: row.expires_at,
    target: { prefix: row.prefix, suffix: row.suffix, caseSensitive: row.case_sensitive === 1, mask: row.mask_hex, value: row.value_hex },
    publicKey: row.public_key,
    deployer: row.deployer,
    initCodeHash: row.init_code_hash,
    quote: { usd: row.quote_usd, difficulty: row.difficulty, expectedSeconds: row.expected_seconds },
    payment: row.pay_address
      ? { asset: row.pay_asset, chain: row.pay_chain, amount: row.pay_amount, address: row.pay_asset === 'BTC' ? row.pay_address : '0x' + toChecksum(row.pay_address), rateUsd: row.eth_usd, ethUsd: row.pay_asset === 'ETH' ? row.eth_usd : null, txid: row.pay_txid }
      : null,
    progress: { attempts: row.attempts, rate: row.rate, runningSeconds: running, overdueMultiple: row.expected_seconds > 0 ? running / row.expected_seconds : 0 },
    result: row.result_hex ? { hex: row.result_hex, address: row.result_address ? '0x' + toChecksum(row.result_address) : null } : null,
    emailSet: !!row.email,
    refundRequested: !!row.refund_requested_at,
    url: `${siteUrl}/order/?t=${row.token}`,
    policy: { refundMultiple: PRO.refundMultiple },
  };
}

async function createOrder(
  env: Env,
  kind: OrderRow['kind'],
  target: Target,
  diff: number,
  extra: { publicKey?: string; deployer?: string; initCodeHash?: string; email?: string; apiKeyId?: number; postpaid?: boolean; payAsset?: 'USDC' | 'ETH' | 'BTC'; fixedUsd?: number },
): Promise<OrderRow> {
  const quote = extra.fixedUsd != null ? { ...quoteForDifficulty(1), usd: extra.fixedUsd, expectedSeconds: 0, tooLarge: false } : quoteForDifficulty(diff);
  if (quote.tooLarge) throw new Error('target too large for online ordering; contact Teams');
  const t = now();
  const token = randomToken();
  const payAsset = extra.payAsset ?? 'USDC';
  let payAmount: string | null = null;
  let payAddress: string | null = null;
  let payIndex: number | null = null;
  let eth: number | null = null;
  let status = 'queued';
  if (!extra.postpaid) {
    status = 'awaiting_payment';
    const seq = await env.DB.prepare('SELECT COALESCE(MAX(pay_index), 0) + 1 AS n FROM orders').first<{ n: number }>();
    payIndex = seq?.n ?? 1;
    if (payAsset === 'BTC') {
      if (!env.BTC_ADDRESS) throw new Error('bitcoin payments are not configured');
      payAddress = env.BTC_ADDRESS;
      eth = await btcUsd();
      let sats = btcAmountSats(quote.usd, eth, payIndex);
      // guarantee a unique amount among orders still awaiting payment
      for (let i = 0; i < 50; i++) {
        const clash = await env.DB.prepare("SELECT id FROM orders WHERE pay_asset = 'BTC' AND status = 'awaiting_payment' AND pay_amount = ?").bind(satsToBtcString(sats)).first();
        if (!clash) break;
        sats += 1n;
      }
      payAmount = satsToBtcString(sats);
    } else {
      if (!env.PAYMENT_XPUB) throw new Error('EVM payments are not configured yet; bitcoin is available');
      payAddress = depositAddress(env.PAYMENT_XPUB, payIndex);
      if (payAsset === 'ETH') {
        eth = await ethUsd();
        payAmount = (quote.usd / eth).toFixed(6);
      } else {
        payAmount = quote.usd.toFixed(2);
      }
    }
  }
  await env.DB.prepare(
    `INSERT INTO orders (token, kind, status, created_at, expires_at, prefix, suffix, case_sensitive, mask_hex, value_hex, public_key, deployer, init_code_hash,
       difficulty, expected_seconds, quote_usd, pay_asset, pay_chain, pay_amount, pay_address, pay_index, eth_usd, email, api_key_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      token,
      kind,
      status,
      t,
      extra.postpaid ? null : t + PRO.paymentWindowHours * 3600,
      target.pattern.prefix,
      target.pattern.suffix,
      target.pattern.caseSensitive ? 1 : 0,
      target.maskHex,
      target.valueHex,
      extra.publicKey ?? null,
      extra.deployer ?? null,
      extra.initCodeHash ?? null,
      diff,
      quote.expectedSeconds,
      quote.usd,
      extra.postpaid ? null : payAsset,
      extra.postpaid ? null : payAsset === 'ETH' ? 'ethereum' : payAsset === 'BTC' ? 'bitcoin' : 'base',
      payAmount,
      payAddress,
      payIndex,
      eth,
      extra.email ?? null,
      extra.apiKeyId ?? null,
    )
    .run();
  const row = await env.DB.prepare('SELECT * FROM orders WHERE token = ?').bind(token).first<OrderRow>();
  if (!row) throw new Error('insert failed');
  return row;
}

/** Cairn Pro: split-key address order. Body: { publicKey, prefix, suffix, caseSensitive, payAsset, email? } */
app.post('/api/orders', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseTarget(body);
  if (typeof parsed === 'string') return bad(c, parsed);
  const pubHex = strip0x(String(body.publicKey ?? '')).toLowerCase();
  if (!/^04[0-9a-f]{128}$/.test(pubHex) || !isValidPublicKey(hexToBytes(pubHex))) return bad(c, 'publicKey must be a valid uncompressed secp256k1 public key');
  const payAsset = parseAsset(body.payAsset);
  const email = typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) ? body.email.trim() : undefined;
  try {
    const row = await createOrder(c.env, 'split', parsed.target, parsed.difficulty, { publicKey: pubHex, payAsset, email });
    return c.json(publicOrder(row, c.env.SITE_URL), 201);
  } catch (e) {
    return bad(c, (e as Error).message, 503);
  }
});

/** Share card unlock: a fixed $3 order with no mining. */
app.post('/api/orders/sharecard', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { payAsset?: string };
  try {
    const row = await createOrder(c.env, 'sharecard', { pattern: { prefix: '', suffix: '', caseSensitive: false }, maskHex: null, valueHex: null }, 1, {
      payAsset: parseAsset(body.payAsset),
      fixedUsd: 3,
    });
    return c.json(publicOrder(row, c.env.SITE_URL), 201);
  } catch (e) {
    return bad(c, (e as Error).message, 503);
  }
});

app.get('/api/orders/:token', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE token = ?').bind(c.req.param('token')).first<OrderRow>();
  if (!row) return bad(c, 'not found', 404);
  // opportunistic payment check for the order being viewed
  if (row.status === 'awaiting_payment') {
    try {
      if (await settleIfPaid(c.env, row)) {
        row.status = 'queued';
        row.paid_at = now();
      }
    } catch {
      // ignore
    }
  }
  return c.json(publicOrder(row, c.env.SITE_URL));
});

app.post('/api/orders/:token/email', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(c, 'invalid email');
  const r = await c.env.DB.prepare('UPDATE orders SET email = ? WHERE token = ?').bind(email || null, c.req.param('token')).run();
  if (!r.meta.changes) return bad(c, 'not found', 404);
  return c.json({ ok: true });
});

app.post('/api/orders/:token/refund', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { address?: string };
  const addr = typeof body.address === 'string' && isAddress(body.address) ? strip0x(body.address).toLowerCase() : null;
  if (!addr) return bad(c, 'refund address required');
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE token = ?').bind(c.req.param('token')).first<OrderRow>();
  if (!row) return bad(c, 'not found', 404);
  const running = row.started_at ? now() - row.started_at : 0;
  const eligible = row.status === 'mining' && running > PRO.refundMultiple * row.expected_seconds;
  if (!eligible) return bad(c, `refunds open once a job has run past ${PRO.refundMultiple}x its estimate`, 409);
  await c.env.DB.prepare('UPDATE orders SET refund_requested_at = ?, refund_address = ? WHERE id = ?').bind(now(), addr, row.id).run();
  return c.json({ ok: true });
});

app.post('/api/contact', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; company?: string; message?: string };
  const email = String(body.email ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || message.length < 5 || message.length > 5000) return bad(c, 'email and message required');
  await c.env.DB.prepare('INSERT INTO contacts (created_at, email, company, message) VALUES (?, ?, ?, ?)').bind(now(), email, String(body.company ?? '').slice(0, 200) || null, message).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Teams API v1 (API key)
// ---------------------------------------------------------------------------

async function apiKey(c: { req: { header: (n: string) => string | undefined }; env: Env }) {
  const h = c.req.header('authorization') ?? '';
  const key = h.replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const hash = await sha256Hex(key);
  return c.env.DB.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND disabled = 0').bind(hash).first<{ id: number; name: string; postpaid: number }>();
}

/** Body: { deployer, initCodeHash, prefix?, suffix?, caseSensitive?, mask?, value?, payAsset? } */
app.post('/api/v1/jobs', async (c) => {
  const key = await apiKey(c);
  if (!key) return bad(c, 'invalid API key', 401);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseTarget(body);
  if (typeof parsed === 'string') return bad(c, parsed);
  const deployer = strip0x(String(body.deployer ?? '')).toLowerCase();
  const initCodeHash = strip0x(String(body.initCodeHash ?? '')).toLowerCase();
  if (!isAddress(deployer)) return bad(c, 'deployer must be a 20-byte address');
  if (!isBytes32Hex(initCodeHash)) return bad(c, 'initCodeHash must be 32 bytes');
  try {
    const row = await createOrder(c.env, 'create2', parsed.target, parsed.difficulty, {
      deployer,
      initCodeHash,
      apiKeyId: key.id,
      postpaid: key.postpaid === 1,
      payAsset: parseAsset(body.payAsset),
    });
    return c.json(publicOrder(row, c.env.SITE_URL), 201);
  } catch (e) {
    return bad(c, (e as Error).message, 503);
  }
});

app.get('/api/v1/jobs/:token', async (c) => {
  const key = await apiKey(c);
  if (!key) return bad(c, 'invalid API key', 401);
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE token = ? AND api_key_id = ?').bind(c.req.param('token'), key.id).first<OrderRow>();
  if (!row) return bad(c, 'not found', 404);
  return c.json(publicOrder(row, c.env.SITE_URL));
});

app.get('/api/v1/quote', (c) => {
  const parsed = parseTarget(c.req.query());
  if (typeof parsed === 'string') return bad(c, parsed);
  return c.json({ quote: quoteForDifficulty(parsed.difficulty) });
});

// ---------------------------------------------------------------------------
// GPU worker queue (shared bearer token)
// ---------------------------------------------------------------------------

function workerAuth(c: { req: { header: (n: string) => string | undefined }; env: Env }): boolean {
  const h = c.req.header('authorization') ?? '';
  return !!c.env.WORKER_TOKEN && h === `Bearer ${c.env.WORKER_TOKEN}`;
}

app.post('/api/worker/next', async (c) => {
  if (!workerAuth(c)) return bad(c, 'unauthorized', 401);
  const body = (await c.req.json().catch(() => ({}))) as { workerId?: string };
  const workerId = String(body.workerId ?? 'anon').slice(0, 64);
  const t = now();
  const row = await c.env.DB.prepare("SELECT * FROM orders WHERE status = 'queued' AND kind IN ('split','create2') ORDER BY paid_at ASC, created_at ASC LIMIT 1").first<OrderRow>();
  if (!row) return c.json({ job: null });
  const r = await c.env.DB.prepare("UPDATE orders SET status = 'mining', started_at = COALESCE(started_at, ?), lease_at = ?, worker_id = ? WHERE id = ? AND status = 'queued'").bind(t, t, workerId, row.id).run();
  if (!r.meta.changes) return c.json({ job: null });
  return c.json({
    job: {
      id: row.token,
      kind: row.kind,
      prefix: row.prefix,
      suffix: row.suffix,
      caseSensitive: row.case_sensitive === 1,
      mask: row.mask_hex,
      value: row.value_hex,
      publicKey: row.public_key,
      deployer: row.deployer,
      initCodeHash: row.init_code_hash,
      attempts: row.attempts,
    },
  });
});

app.post('/api/worker/heartbeat', async (c) => {
  if (!workerAuth(c)) return bad(c, 'unauthorized', 401);
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; attempts?: number; rate?: number };
  await c.env.DB.prepare("UPDATE orders SET lease_at = ?, attempts = ?, rate = ? WHERE token = ? AND status = 'mining'")
    .bind(now(), Number(body.attempts ?? 0), Number(body.rate ?? 0), String(body.id ?? ''))
    .run();
  return c.json({ ok: true });
});

/** Body: { id, hex } where hex is the offset (split) or salt (create2). Verified server-side before acceptance. */
app.post('/api/worker/result', async (c) => {
  if (!workerAuth(c)) return bad(c, 'unauthorized', 401);
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; hex?: string; attempts?: number };
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE token = ?').bind(String(body.id ?? '')).first<OrderRow>();
  if (!row) return bad(c, 'not found', 404);
  const hex = strip0x(String(body.hex ?? '')).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return bad(c, 'hex must be 32 bytes');
  let address: string;
  try {
    address = row.kind === 'split' ? splitKeyAddress(hexToBytes(row.public_key!), hexToBytes(hex)) : create2Address(hexToBytes(row.deployer!), hexToBytes(hex), hexToBytes(row.init_code_hash!));
  } catch (e) {
    return bad(c, 'derivation failed: ' + (e as Error).message);
  }
  if (!targetMatches(address, row)) return bad(c, 'result does not satisfy the target', 422);
  await c.env.DB.prepare("UPDATE orders SET status = 'found', found_at = ?, result_hex = ?, result_address = ?, attempts = ? WHERE id = ?")
    .bind(now(), hex, address, Number(body.attempts ?? row.attempts), row.id)
    .run();
  return c.json({ ok: true, address: '0x' + toChecksum(address) });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

function adminAuth(c: { req: { header: (n: string) => string | undefined }; env: Env }): boolean {
  const h = c.req.header('authorization') ?? '';
  return !!c.env.ADMIN_TOKEN && h === `Bearer ${c.env.ADMIN_TOKEN}`;
}

app.post('/api/admin/keys', async (c) => {
  if (!adminAuth(c)) return bad(c, 'unauthorized', 401);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; postpaid?: boolean };
  const key = 'cairn_' + randomToken(24);
  await c.env.DB.prepare('INSERT INTO api_keys (key_hash, name, postpaid, created_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(key), String(body.name ?? 'unnamed').slice(0, 100), body.postpaid ? 1 : 0, now()).run();
  return c.json({ key, name: body.name, postpaid: !!body.postpaid });
});

app.get('/api/admin/orders', async (c) => {
  if (!adminAuth(c)) return bad(c, 'unauthorized', 401);
  const { results } = await c.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all<OrderRow>();
  return c.json({ orders: results.map((r) => publicOrder(r, c.env.SITE_URL)) });
});

app.post('/api/admin/check-payments', async (c) => {
  if (!adminAuth(c)) return bad(c, 'unauthorized', 401);
  return c.json({ paid: await checkPayments(c.env) });
});

app.get('/api/admin/contacts', async (c) => {
  if (!adminAuth(c)) return bad(c, 'unauthorized', 401);
  const { results } = await c.env.DB.prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 200').all();
  return c.json({ contacts: results });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await checkPayments(env);
  },
};
