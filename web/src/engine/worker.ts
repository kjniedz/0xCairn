/**
 * CPU mining worker. One instance per core. Loads the WASM kernel, seeds
 * itself with a full 256-bit scalar from crypto.getRandomValues and walks
 * keys from there. Never talks to the network.
 */
import { Kernel } from '../lib/kernel';
import wasmUrl from '../kernel/cairn_kernel.wasm?url';
import type { WorkerIn, WorkerOut, WorkerJob } from './types';

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

let kernel: Kernel | null = null;
let job: WorkerJob | null = null;
let running = false;
let paused = false;
let chunk = 1;
let lastProgress = 0;
let generation = 0;

const TARGET_CHUNK_MS = 40;
const IMPOSSIBLE_PREFIX = 'ffffffffffffffffffffffffffffffffffffffff';

function randomSeed(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

function initMiner(k: Kernel, lanes: number, base?: Uint8Array): void {
  // Rejection-sample seeds the kernel refuses (zero or >= curve order): ~1 in 2^128.
  for (let i = 0; i < 8; i++) {
    try {
      k.minerInit(randomSeed(), lanes, base);
      return;
    } catch (e) {
      if (base && i > 0) throw e;
    }
  }
  throw new Error('could not seed miner');
}

function attempts(): number {
  if (!kernel || !job) return 0;
  return job.kind === 'address' ? kernel.attempts() : kernel.create2Attempts();
}

function tick(gen: number): void {
  if (gen !== generation || !running || paused || !kernel || !job) return;
  const t0 = performance.now();
  let found = false;
  try {
    found = job.kind === 'address' ? kernel.mine(chunk) : kernel.create2Mine(chunk);
  } catch (e) {
    post({ type: 'error', message: (e as Error).message });
    running = false;
    return;
  }
  const dt = performance.now() - t0;
  if (dt < TARGET_CHUNK_MS / 2) chunk = Math.min(chunk * 2, 1 << 22);
  else if (dt > TARGET_CHUNK_MS * 2) chunk = Math.max(1, chunk >> 1);

  const now = performance.now();
  if (found) {
    const f = job.kind === 'address' ? kernel.found() : kernel.create2Found();
    if (f) post({ type: 'found', key: f.key, address: f.address, attempts: attempts() });
    lastProgress = now;
  } else if (now - lastProgress > 200) {
    const sample = (job.kind === 'address' ? kernel.sample() : kernel.create2Sample()) ?? undefined;
    post({ type: 'progress', attempts: attempts(), sample });
    lastProgress = now;
  }
  setTimeout(() => tick(gen), 0);
}

async function bench(ms: number): Promise<void> {
  if (!kernel) return;
  const k = kernel;
  k.setPattern(IMPOSSIBLE_PREFIX, '', false);
  initMiner(k, 512);
  const t0 = performance.now();
  let rounds = 1;
  // warm up briefly then measure
  while (performance.now() - t0 < 60) k.mine(1);
  const before = k.attempts();
  const t1 = performance.now();
  while (performance.now() - t1 < ms) {
    k.mine(rounds);
    if (rounds < 64) rounds *= 2;
  }
  const dt = (performance.now() - t1) / 1000;
  post({ type: 'bench', rate: (k.attempts() - before) / dt });
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': {
        kernel = await Kernel.load(fetch(wasmUrl));
        post({ type: 'ready' });
        break;
      }
      case 'bench': {
        await bench(m.ms);
        break;
      }
      case 'start': {
        if (!kernel) throw new Error('kernel not loaded');
        job = m.job;
        kernel.setPattern(job.prefix, job.suffix, job.caseSensitive);
        if (job.kind === 'address') {
          initMiner(kernel, job.lanes, job.base);
        } else {
          kernel.create2Init(job.deployer, job.initCodeHash, randomSeed());
        }
        running = true;
        paused = false;
        chunk = 1;
        lastProgress = performance.now();
        generation++;
        tick(generation);
        break;
      }
      case 'pause':
        paused = true;
        post({ type: 'progress', attempts: attempts() });
        break;
      case 'resume':
        if (running && paused) {
          paused = false;
          generation++;
          tick(generation);
        }
        break;
      case 'stop':
        running = false;
        paused = false;
        job = null;
        generation++;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
