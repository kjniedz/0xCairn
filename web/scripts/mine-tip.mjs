// Mines the project tip address with the same WASM kernel the site uses.
// Writes the PRIVATE KEY to ~/.0xcairn-tip-key.txt (chmod 600), never into the repo.
// Usage: node scripts/mine-tip.mjs [prefix] [suffix] [caseSensitive]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const WASM = new URL('../src/kernel/cairn_kernel.wasm', import.meta.url);
const prefix = process.argv[2] ?? 'Ca1';
const suffix = process.argv[3] ?? 'ca1';
const cs = (process.argv[4] ?? '1') === '1';

if (isMainThread) {
  const n = Math.max(1, os.cpus().length - 2);
  const t0 = Date.now();
  let done = false;
  const workers = [];
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { prefix, suffix, cs } });
    workers.push(w);
    w.on('message', (m) => {
      if (done) return;
      done = true;
      const out = path.join(os.homedir(), '.0xcairn-tip-key.txt');
      fs.writeFileSync(out, `address=0x${m.address}\nprivate_key=0x${m.key}\nmined=${new Date().toISOString()}\n`, { mode: 0o600 });
      console.log(`found 0x${m.address} after ${((Date.now() - t0) / 1000).toFixed(0)}s; key written to ${out}`);
      for (const x of workers) x.terminate();
    });
  }
} else {
  const bytes = fs.readFileSync(WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  const mem = () => new Uint8Array(ex.memory.buffer);
  const io = ex.io_ptr();
  const { prefix, suffix, cs } = workerData;
  const enc = new TextEncoder();
  mem().set(enc.encode(prefix + suffix), io);
  if (ex.set_pattern(prefix.length, suffix.length, cs ? 1 : 0) !== 0) throw new Error('bad pattern');
  mem().set(crypto.randomBytes(32), io);
  if (ex.miner_init(512, 0) !== 0) throw new Error('seed rejected');
  while (ex.miner_mine(16) !== 1) {}
  ex.miner_found();
  const key = Buffer.from(mem().slice(io, io + 32)).toString('hex');
  const address = Buffer.from(mem().slice(io + 32, io + 52)).toString('hex');
  parentPort.postMessage({ key, address });
}
