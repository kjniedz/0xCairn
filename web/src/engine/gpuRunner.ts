/**
 * Drives the WebGPU kernel from the main thread. Runs a self-test against a
 * known target before it is ever trusted, and only hands back candidates that
 * the SearchController re-verifies with the independent noble implementation.
 */
import { GpuEngine } from '../gpu/gpu';
import shaderSource from '../gpu/kernel.wgsl?raw';
import wasmUrl from '../kernel/cairn_kernel.wasm?url';
import { Kernel } from '../lib/kernel';
import { packForGpu, normalizePattern } from '../lib/pattern';
import { randomScalar, randomBytes32, addScalarBig, addSalt, mulG, privateKeyToAddress, hexToBytes } from '../lib/eth';
import type { Candidate, Job } from './types';

const K = 16;
const PREFERRED_THREADS = 32768;
const TARGET_STEP_MS = 110;

export interface GpuProbe {
  available: boolean;
  description: string;
  benchRate: number | null;
  error: string | null;
}

export class GpuRunner {
  private engine: GpuEngine | null = null;
  private kernel: Kernel | null = null;
  private running = false;
  private paused = false;
  private generation = 0;
  private rounds = 1;
  private seed: Uint8Array | null = null;
  private saltBase: Uint8Array | null = null;
  private lanes = 0;
  attempts = 0;
  description = '';
  onFound: ((c: Candidate, attempts: number) => void) | null = null;
  onProgress: ((attempts: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  static supported(): boolean {
    return GpuEngine.supported();
  }

  private async ensureEngine(): Promise<GpuEngine> {
    if (this.engine) return this.engine;
    let engine = await GpuEngine.create(shaderSource, { K, threads: PREFERRED_THREADS });
    if (!engine) engine = await GpuEngine.create(shaderSource, { K, threads: 8192 });
    if (!engine) throw new Error('WebGPU adapter unavailable or buffer limits too small');
    this.engine = engine;
    this.description = [engine.info.description, engine.info.vendor, engine.info.architecture].filter(Boolean).join(' ') || 'WebGPU device';
    return engine;
  }

  private async ensureKernel(): Promise<Kernel> {
    if (!this.kernel) this.kernel = await Kernel.load(fetch(wasmUrl));
    return this.kernel;
  }

  /**
   * Compile, self-test against a key at a known (index, round), then benchmark.
   * Any failure marks the GPU unavailable for this session.
   */
  async probe(benchMs = 700): Promise<GpuProbe> {
    try {
      const engine = await this.ensureEngine();
      const kernel = await this.ensureKernel();
      const lanes = engine.threads * engine.K;
      const seed = randomScalar();
      kernel.minerInit(seed, lanes);
      const laneBytes = kernel.exportLanes();
      const delta = mulG(BigInt(lanes));
      const idx = Math.floor(Math.random() * lanes);
      const round = 1;
      const key = addScalarBig(seed, BigInt(idx) + BigInt(round) * BigInt(lanes));
      const addr = privateKeyToAddress(key);
      await engine.beginAddress(laneBytes, delta, packForGpu({ prefix: addr, suffix: '', caseSensitive: false }));
      const hits = (await engine.step(2)).hits;
      if (hits.length !== 1 || hits[0].idx !== idx || hits[0].round !== round) {
        throw new Error('GPU self-test failed (kernel produced a wrong result); GPU disabled');
      }
      // benchmark with an impossible pattern
      await engine.beginAddress(laneBytes, delta, packForGpu({ prefix: 'ffffffffffffffffffffffffffffffffffffffff', suffix: '', caseSensitive: false }));
      let rounds = 1;
      let attempts = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < benchMs) {
        const r = await engine.step(rounds);
        attempts += r.attempts;
        rounds = Math.max(1, Math.min(32, Math.round((rounds * TARGET_STEP_MS) / Math.max(r.ms, 1))));
      }
      const rate = attempts / ((performance.now() - t0) / 1000);
      this.rounds = rounds;
      return { available: true, description: this.description, benchRate: rate, error: null };
    } catch (e) {
      this.engine?.destroy();
      this.engine = null;
      return { available: false, description: this.description, benchRate: null, error: (e as Error).message };
    }
  }

  async start(job: Job): Promise<void> {
    const engine = await this.ensureEngine();
    const p = normalizePattern(job.pattern);
    const packed = packForGpu(p);
    this.attempts = 0;
    this.generation++;
    const gen = this.generation;
    if (job.kind === 'address') {
      const kernel = await this.ensureKernel();
      this.lanes = engine.threads * engine.K;
      this.seed = randomScalar();
      kernel.minerInit(this.seed, this.lanes, job.base);
      const laneBytes = kernel.exportLanes();
      await engine.beginAddress(laneBytes, mulG(BigInt(this.lanes)), packed);
    } else {
      this.saltBase = randomBytes32();
      await engine.beginCreate2(job.deployer, job.initCodeHash, this.saltBase, packed);
    }
    if (gen !== this.generation) return;
    this.running = true;
    this.paused = false;
    void this.loop(gen, job);
  }

  private async loop(gen: number, job: Job): Promise<void> {
    const engine = this.engine!;
    let lastProgress = performance.now();
    while (gen === this.generation && this.running && !this.paused) {
      let r;
      try {
        r = await engine.step(this.rounds);
      } catch (e) {
        this.onError?.((e as Error).message);
        this.running = false;
        return;
      }
      if (gen !== this.generation) return;
      this.attempts += r.attempts;
      this.rounds = Math.max(1, Math.min(64, Math.round((this.rounds * TARGET_STEP_MS) / Math.max(r.ms, 1))));
      for (const h of r.hits) {
        const offset = BigInt(h.idx) + BigInt(h.round) * BigInt(engine.keysPerRound);
        if (job.kind === 'address') {
          const key = addScalarBig(this.seed!, offset);
          this.onFound?.({ key, address: hexToBytes(''), engine: 'gpu' }, this.attempts);
        } else {
          const salt = addSalt(this.saltBase!, offset);
          this.onFound?.({ key: salt, address: hexToBytes(''), engine: 'gpu' }, this.attempts);
        }
      }
      const now = performance.now();
      if (now - lastProgress > 200) {
        this.onProgress?.(this.attempts);
        lastProgress = now;
      }
    }
  }

  pause(): void {
    this.paused = true;
    this.generation++;
  }

  resume(job: Job): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.generation++;
    void this.loop(this.generation, job);
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.generation++;
  }

  destroy(): void {
    this.stop();
    this.engine?.destroy();
    this.engine = null;
  }
}
