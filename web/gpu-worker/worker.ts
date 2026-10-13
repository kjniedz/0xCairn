/**
 * 0xCairn GPU worker: pulls jobs from the API queue and mines them with the
 * same WGSL kernel the website uses, via Deno's WebGPU. Falls back to the
 * WASM kernel on CPU when no GPU adapter is present.
 *
 *   cd web && npm run worker -- --api https://0xcairn.example --token $WORKER_TOKEN [--id rig-1] [--cpu]
 *
 * The worker never sees a private key. Split jobs carry the requester's
 * public key; CREATE2 jobs carry public deployer data. Every hit is verified
 * locally with @noble before it is reported, and the API verifies it again.
 */
import { parseArgs } from 'jsr:@std/cli@1/parse-args';
import { GpuEngine } from '../src/gpu/gpu.ts';
import { Kernel } from '../src/lib/kernel.ts';
import { packForGpu, matchesPattern, type Pattern } from '../src/lib/pattern.ts';
import { randomScalar, randomBytes32, addScalarBig, addSalt, mulG, hexToBytes, bytesToHex, splitKeyAddress, create2Address, toChecksum } from '../src/lib/eth.ts';

const args = parseArgs(Deno.args, { string: ['api', 'token', 'id'], boolean: ['cpu'], default: { id: Deno.hostname() } });
const API = (args.api ?? Deno.env.get('CAIRN_API') ?? '').replace(/\/$/, '');
const TOKEN = args.token ?? Deno.env.get('CAIRN_WORKER_TOKEN') ?? '';
if (!API || !TOKEN) {
  console.error('usage: worker.ts --api <url> --token <WORKER_TOKEN> [--id name] [--cpu]');
  Deno.exit(2);
}
const here = new URL('.', import.meta.url);
const shader = await Deno.readTextFile(new URL('../src/gpu/kernel.wgsl', here));
const wasm = await Deno.readFile(new URL('../src/kernel/cairn_kernel.wasm', here));

interface Job {
  id: string;
  kind: 'split' | 'create2';
  prefix: string;
  suffix: string;
  caseSensitive: boolean;
  mask: string | null;
  value: string | null;
  publicKey: string | null;
  deployer: string | null;
  initCodeHash: string | null;
  attempts: number;
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j as T;
}

function packed(job: Job) {
  const p: Pattern = { prefix: job.prefix.toLowerCase(), suffix: job.suffix.toLowerCase(), caseSensitive: job.caseSensitive, mask: job.mask ?? undefined, value: job.value ?? undefined };
  return packForGpu(p);
}

function maskOk(address: string, job: Job): boolean {
  if (!job.mask || !job.value) return true;
  const a = hexToBytes(address), m = hexToBytes(job.mask), v = hexToBytes(job.value);
  for (let i = 0; i < 20; i++) if ((a[i] & m[i]) !== (v[i] & m[i])) return false;
  return true;
}

function verify(job: Job, hex: Uint8Array): string | null {
  const address = job.kind === 'split' ? splitKeyAddress(hexToBytes(job.publicKey!), hex) : create2Address(hexToBytes(job.deployer!), hex, hexToBytes(job.initCodeHash!));
  const p: Pattern = { prefix: job.prefix, suffix: job.suffix, caseSensitive: job.caseSensitive, mask: job.mask ?? undefined, value: job.value ?? undefined };
  if (!matchesPattern(address, toChecksum(address), p)) return null;
  if (!maskOk(address, job)) return null;
  return address;
}

async function mineGpu(job: Job, engine: GpuEngine): Promise<Uint8Array> {
  const kernel = await Kernel.load(wasm);
  const pat = packed(job);
  let seed: Uint8Array | null = null;
  let saltBase: Uint8Array | null = null;
  if (job.kind === 'split') {
    const lanes = engine.threads * engine.K;
    seed = randomScalar();
    kernel.minerInit(seed, lanes, hexToBytes(job.publicKey!));
    await engine.beginAddress(kernel.exportLanes(), mulG(BigInt(lanes)), pat);
  } else {
    saltBase = randomBytes32();
    await engine.beginCreate2(hexToBytes(job.deployer!), hexToBytes(job.initCodeHash!), saltBase, pat);
  }
  let rounds = 1;
  let attempts = job.attempts;
  let lastBeat = Date.now();
  const t0 = Date.now();
  let since = 0;
  for (;;) {
    const r = await engine.step(rounds);
    attempts += r.attempts;
    since += r.attempts;
    rounds = Math.max(1, Math.min(64, Math.round((rounds * 150) / Math.max(r.ms, 1))));
    for (const h of r.hits) {
      const off = BigInt(h.idx) + BigInt(h.round) * BigInt(engine.keysPerRound);
      const hex = job.kind === 'split' ? addScalarBig(seed!, off) : addSalt(saltBase!, off);
      if (verify(job, hex)) return hex;
      console.warn('gpu hit failed local verification; continuing');
    }
    if (Date.now() - lastBeat > 30000) {
      const rate = since / ((Date.now() - lastBeat) / 1000);
      await api('/api/worker/heartbeat', { id: job.id, attempts, rate }).catch((e) => console.warn('heartbeat failed', e.message));
      lastBeat = Date.now();
      since = 0;
      console.log(`${job.id}: ${(attempts / 1e6).toFixed(0)}M attempts, ${(rate / 1e6).toFixed(1)} M/s, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
  }
}

async function mineCpu(job: Job): Promise<Uint8Array> {
  const kernel = await Kernel.load(wasm);
  kernel.setPattern(job.prefix, job.suffix, job.caseSensitive);
  if (job.mask && job.value) kernel.setMask(hexToBytes(job.mask), hexToBytes(job.value));
  let attempts = job.attempts;
  let lastBeat = Date.now();
  if (job.kind === 'split') {
    kernel.minerInit(randomScalar(), 1024, hexToBytes(job.publicKey!));
    for (;;) {
      if (kernel.mine(64)) {
        const f = kernel.found()!;
        if (verify(job, f.key)) return f.key;
      }
      if (Date.now() - lastBeat > 30000) {
        attempts = kernel.attempts();
        await api('/api/worker/heartbeat', { id: job.id, attempts, rate: 0 }).catch(() => {});
        lastBeat = Date.now();
      }
    }
  }
  kernel.create2Init(hexToBytes(job.deployer!), hexToBytes(job.initCodeHash!), randomBytes32());
  for (;;) {
    if (kernel.create2Mine(1 << 16)) {
      const f = kernel.create2Found()!;
      if (verify(job, f.key)) return f.key;
    }
    if (Date.now() - lastBeat > 30000) {
      attempts = kernel.create2Attempts();
      await api('/api/worker/heartbeat', { id: job.id, attempts, rate: 0 }).catch(() => {});
      lastBeat = Date.now();
    }
  }
}

let engine: GpuEngine | null = null;
if (!args.cpu) {
  engine = await GpuEngine.create(shader, { K: 16, threads: 32768 });
  console.log(engine ? `GPU: ${engine.info.description || engine.info.vendor}` : 'no WebGPU adapter; using CPU');
}

for (;;) {
  let job: Job | null = null;
  try {
    job = (await api<{ job: Job | null }>('/api/worker/next', { workerId: args.id })).job;
  } catch (e) {
    console.warn('queue poll failed:', (e as Error).message);
  }
  if (!job) {
    await new Promise((r) => setTimeout(r, 15000));
    continue;
  }
  console.log(`job ${job.id}: ${job.kind} 0x${job.prefix}…${job.suffix}${job.mask ? ' +mask' : ''}`);
  try {
    const hex = engine ? await mineGpu(job, engine) : await mineCpu(job);
    const res = await api<{ address: string }>('/api/worker/result', { id: job.id, hex: bytesToHex(hex) });
    console.log(`job ${job.id}: found ${res.address}`);
  } catch (e) {
    console.error(`job ${job.id} failed:`, (e as Error).message);
    await new Promise((r) => setTimeout(r, 10000));
  }
}
