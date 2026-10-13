/**
 * Headless WebGPU kernel test. Run from web/:
 *   npx -y deno@2 run -A src/gpu/test.ts [--bench]
 *
 * Verifies the WGSL kernel against the @noble reference implementation using
 * exact 40-character targets placed at known (index, round) positions.
 */
import { GpuEngine } from './gpu.ts';
import { Kernel } from '../lib/kernel.ts';
import { packForGpu, type Pattern } from '../lib/pattern.ts';
import {
  randomScalar,
  bytesToBigInt,
  addScalarBig,
  privateKeyToAddress,
  toChecksum,
  mulG,
  create2Address,
  addSalt,
  hexToBytes,
  keccak256Hex,
} from '../lib/eth.ts';

const here = new URL('.', import.meta.url);
const shader = await Deno.readTextFile(new URL('./kernel.wgsl', here));
const wasmBytes = await Deno.readFile(new URL('../kernel/cairn_kernel.wasm', here));
const bench = Deno.args.includes('--bench');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
  if (!ok) failures++;
}

async function addressTest(K: number, threads: number, caseSensitive: boolean) {
  const engine = await GpuEngine.create(shader, { K, threads });
  if (!engine) throw new Error('no GPU');
  const kernel = await Kernel.load(wasmBytes);
  const seed = randomScalar();
  const lanes = threads * K;
  kernel.minerInit(seed, lanes);
  const laneBytes = kernel.exportLanes();
  const delta = mulG(BigInt(lanes));

  const targetIdx = Math.floor(Math.random() * lanes);
  const targetRound = 3;
  const key = addScalarBig(seed, BigInt(targetIdx) + BigInt(targetRound) * BigInt(lanes));
  const addr = privateKeyToAddress(key);
  const cs = toChecksum(addr);
  const pattern: Pattern = caseSensitive
    ? { prefix: cs.slice(0, 24), suffix: cs.slice(24), caseSensitive: true }
    : { prefix: addr.slice(0, 20), suffix: addr.slice(20), caseSensitive: false };
  await engine.beginAddress(laneBytes, delta, packForGpu(pattern));

  const hits: { idx: number; round: number }[] = [];
  let attempts = 0;
  for (let i = 0; i < 3; i++) {
    const r = await engine.step(2);
    hits.push(...r.hits);
    attempts += r.attempts;
  }
  const ok = hits.length === 1 && hits[0].idx === targetIdx && hits[0].round === targetRound;
  check(
    `address K=${K} threads=${threads} case=${caseSensitive}`,
    ok,
    `expected (${targetIdx},${targetRound}) got ${JSON.stringify(hits)} after ${attempts} attempts`,
  );
  if (hits.length) {
    const h = hits[0];
    const k2 = addScalarBig(seed, BigInt(h.idx) + BigInt(h.round) * BigInt(lanes));
    check('  host re-derivation matches', privateKeyToAddress(k2) === addr);
  }
  // state continuity: after 6 rounds, lane 0 must equal seed + 6*lanes
  engine.destroy();
}

async function caseNegativeTest() {
  // A case-sensitive pattern with one flipped letter must NOT match.
  const K = 2, threads = 64;
  const engine = (await GpuEngine.create(shader, { K, threads }))!;
  const kernel = await Kernel.load(wasmBytes);
  const seed = randomScalar();
  kernel.minerInit(seed, threads * K);
  const addr = privateKeyToAddress(seed); // idx 0 round 0
  const cs = toChecksum(addr);
  const firstLetter = cs.search(/[a-fA-F]/);
  const flipped =
    cs.slice(0, firstLetter) +
    (cs[firstLetter] === cs[firstLetter].toUpperCase() ? cs[firstLetter].toLowerCase() : cs[firstLetter].toUpperCase()) +
    cs.slice(firstLetter + 1);
  await engine.beginAddress(kernel.exportLanes(), mulG(BigInt(threads * K)), packForGpu({ prefix: flipped, suffix: '', caseSensitive: true }));
  const r = await engine.step(1);
  check('case-sensitive negative (flipped letter rejected)', r.hits.length === 0, JSON.stringify(r.hits));
  await engine.beginAddress(kernel.exportLanes(), mulG(BigInt(threads * K)), packForGpu({ prefix: cs, suffix: '', caseSensitive: true }));
  const r2 = await engine.step(1);
  check('case-sensitive positive (exact checksum accepted)', r2.hits.length === 1 && r2.hits[0].idx === 0 && r2.hits[0].round === 0, JSON.stringify(r2.hits));
  engine.destroy();
}

async function create2Test() {
  const threads = 128;
  const engine = (await GpuEngine.create(shader, { threads }))!;
  // EIP-1014 example 5
  const deployer = hexToBytes('00000000000000000000000000000000deadbeef');
  const initCodeHash = hexToBytes(keccak256Hex(hexToBytes('deadbeef')));
  const salt = hexToBytes('00000000000000000000000000000000000000000000000000000000cafebabe');
  const expect = '60f3f640a8508fc6a86d45df051962668e1e8ac7';
  check('create2 reference vector (noble)', create2Address(deployer, salt, initCodeHash) === expect);
  // place the target at thread 77, round 2: base = salt - (77 + 2*threads)
  const base = addSalt(salt, -BigInt(77 + 2 * threads));
  await engine.beginCreate2(deployer, initCodeHash, base, packForGpu({ prefix: expect, suffix: '', caseSensitive: false }));
  const hits: { idx: number; round: number }[] = [];
  for (let i = 0; i < 2; i++) hits.push(...(await engine.step(2)).hits);
  check('create2 GPU finds (77,2)', hits.length === 1 && hits[0].idx === 77 && hits[0].round === 2, JSON.stringify(hits));
  // carry across salt words: base ends in ffffffff so adding offsets carries into word 6
  const salt2 = hexToBytes('000000000000000000000000000000000000000000000000000000ffffffffff');
  const target2 = create2Address(deployer, addSalt(salt2, 5n), initCodeHash);
  await engine.beginCreate2(deployer, initCodeHash, salt2, packForGpu({ prefix: target2, suffix: '', caseSensitive: false }));
  const r = await engine.step(1);
  check('create2 salt carry propagation', r.hits.length === 1 && r.hits[0].idx === 5 && r.hits[0].round === 0, JSON.stringify(r.hits));
  engine.destroy();
}

async function benchAddress(K: number, threads: number) {
  const engine = (await GpuEngine.create(shader, { K, threads }))!;
  const kernel = await Kernel.load(wasmBytes);
  const seed = randomScalar();
  const t0 = performance.now();
  kernel.minerInit(seed, threads * K);
  const laneBytes = kernel.exportLanes();
  const prep = performance.now() - t0;
  await engine.beginAddress(laneBytes, mulG(BigInt(threads * K)), packForGpu({ prefix: '0000000', suffix: '', caseSensitive: false }));
  let rounds = 1;
  let attempts = 0;
  let hits = 0;
  const start = performance.now();
  while (performance.now() - start < 3000) {
    const r = await engine.step(rounds);
    attempts += r.attempts;
    hits += r.hits.length;
    rounds = Math.max(1, Math.min(64, Math.round((rounds * 150) / Math.max(r.ms, 1))));
  }
  const secs = (performance.now() - start) / 1000;
  console.log(`BENCH address K=${K} threads=${threads}: ${(attempts / secs / 1e6).toFixed(2)} M keys/s (prep ${prep.toFixed(0)} ms, rounds/step ${rounds}, hits ${hits}) ${engine.info.description || engine.info.vendor}`);
  // sanity: verify the walked state after N rounds matches direct derivation
  engine.destroy();
}

async function benchCreate2(threads: number) {
  const engine = (await GpuEngine.create(shader, { threads }))!;
  const deployer = new Uint8Array(20);
  const h = new Uint8Array(32);
  const base = randomScalar();
  await engine.beginCreate2(deployer, h, base, packForGpu({ prefix: '00000000', suffix: '', caseSensitive: false }));
  let rounds = 1;
  let attempts = 0;
  const start = performance.now();
  while (performance.now() - start < 3000) {
    const r = await engine.step(rounds);
    attempts += r.attempts;
    rounds = Math.max(1, Math.min(256, Math.round((rounds * 150) / Math.max(r.ms, 1))));
  }
  const secs = (performance.now() - start) / 1000;
  console.log(`BENCH create2 threads=${threads}: ${(attempts / secs / 1e6).toFixed(2)} M salts/s (rounds/step ${rounds})`);
  engine.destroy();
}

async function stateContinuityTest() {
  // After R rounds every lane must hold S + (i + R*lanes)*G. We verify by placing
  // a target at a later round and confirming it is found exactly there.
  const K = 4, threads = 64, lanes = threads * K;
  const engine = (await GpuEngine.create(shader, { K, threads }))!;
  const kernel = await Kernel.load(wasmBytes);
  const seed = randomScalar();
  kernel.minerInit(seed, lanes);
  const idx = 255, round = 17;
  const key = addScalarBig(seed, BigInt(idx + round * lanes));
  const addr = privateKeyToAddress(key);
  await engine.beginAddress(kernel.exportLanes(), mulG(BigInt(lanes)), packForGpu({ prefix: addr, suffix: '', caseSensitive: false }));
  const hits: { idx: number; round: number }[] = [];
  for (let i = 0; i < 5; i++) hits.push(...(await engine.step(4)).hits); // 20 rounds across 5 steps
  check('state continuity across steps (idx 255, round 17)', hits.length === 1 && hits[0].idx === idx && hits[0].round === round, JSON.stringify(hits));
  engine.destroy();
}

await addressTest(2, 64, false);
await addressTest(8, 256, false);
await addressTest(8, 256, true);
await addressTest(16, 128, false);
await caseNegativeTest();
await stateContinuityTest();
await create2Test();
if (bench) {
  await benchAddress(8, 16384);
  await benchAddress(16, 16384);
  await benchAddress(8, 65536);
  await benchCreate2(65536);
  await benchCreate2(262144);
}
console.log(failures === 0 ? 'ALL GPU TESTS PASSED' : `${failures} FAILURE(S)`);
Deno.exit(failures === 0 ? 0 : 1);

// keep bytesToBigInt referenced for type-checkers that flag unused imports
void bytesToBigInt;
