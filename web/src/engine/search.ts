/**
 * SearchController: coordinates the CPU worker pool and the GPU runner,
 * aggregates stats, and re-verifies every candidate with the independent
 * noble implementation before it becomes a result.
 */
import { CpuPool } from './cpuPool';
import { GpuRunner } from './gpuRunner';
import type { Candidate, Job, SearchResult, SearchSnapshot, SearchStatus, EngineStats } from './types';
import { matchesPattern, normalizePattern } from '../lib/pattern';
import { bytesToHex, privateKeyToAddress, toChecksum, create2Address, splitKeyAddress } from '../lib/eth';

type Listener = (s: SearchSnapshot) => void;

export class SearchController {
  private pool = new CpuPool();
  private gpu: GpuRunner | null = null;
  private listeners = new Set<Listener>();
  private status: SearchStatus = 'idle';
  private job: Job | null = null;
  private results: SearchResult[] = [];
  private error: string | null = null;
  private verificationFailures = 0;
  private cpuAttempts = 0;
  private gpuAttempts = 0;
  private runStart = 0;
  private accumulatedMs = 0;
  private rateWindow: Array<{ t: number; cpu: number; gpu: number }> = [];
  private cpuLive = 0;
  private gpuLive = 0;
  private emitTimer: number | null = null;
  private workersWanted: number;
  private seenSecrets = new Set<string>();
  private sample: Uint8Array | null = null;
  private benching = false;

  engines: EngineStats = {
    cpu: { workers: 0, ready: false, benchRate: null, liveRate: 0 },
    gpu: { supported: GpuRunner.supported(), available: false, enabled: false, checking: false, description: '', benchRate: null, liveRate: 0, error: null },
  };

  constructor() {
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    this.workersWanted = Math.max(1, Math.min(cores, 32));
    this.pool.onFound = (c, attempts) => {
      this.cpuAttempts = attempts;
      this.onCandidate(c);
    };
    this.pool.onProgress = (a, sample) => {
      this.cpuAttempts = a;
      if (sample) this.sample = sample;
      this.scheduleEmit();
    };
    this.pool.onError = (m) => this.fail(`CPU worker error: ${m}`);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  get maxWorkers(): number {
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    return Math.max(1, Math.min(cores, 32));
  }

  /** Spin up workers, load the kernel everywhere and benchmark. */
  async init(): Promise<void> {
    try {
      await this.pool.setSize(this.workersWanted);
      this.engines.cpu.workers = this.workersWanted;
      this.engines.cpu.ready = true;
      this.emit();
      const rate = await this.pool.bench(450);
      this.engines.cpu.benchRate = rate;
      this.emit();
    } catch (e) {
      this.fail(`Could not start CPU workers: ${(e as Error).message}`);
    }
    if (this.engines.gpu.supported) void this.probeGpu();
  }

  async probeGpu(): Promise<void> {
    if (!this.engines.gpu.supported || this.engines.gpu.checking) return;
    this.engines.gpu.checking = true;
    this.emit();
    try {
      this.gpu = this.gpu ?? new GpuRunner();
      this.gpu.onFound = (c, attempts) => {
        this.gpuAttempts = attempts;
        this.onCandidate(c);
      };
      this.gpu.onProgress = (a) => {
        this.gpuAttempts = a;
        this.scheduleEmit();
      };
      this.gpu.onError = (m) => this.disableGpu(`GPU error: ${m}`);
      const probe = await this.gpu.probe();
      this.engines.gpu.available = probe.available;
      this.engines.gpu.enabled = probe.available;
      this.engines.gpu.description = formatGpuName(probe.description);
      this.engines.gpu.benchRate = probe.benchRate;
      this.engines.gpu.error = probe.error;
    } catch (e) {
      this.engines.gpu.available = false;
      this.engines.gpu.enabled = false;
      this.engines.gpu.error = (e as Error).message;
    } finally {
      this.engines.gpu.checking = false;
      this.emit();
    }
  }

  /** Re-run the CPU and GPU benchmarks (about 3 seconds). */
  async rebench(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting' || this.benching) return;
    this.benching = true;
    this.emit();
    try {
      if (this.pool.size !== this.workersWanted) await this.pool.setSize(this.workersWanted);
      this.engines.cpu.benchRate = await this.pool.bench(1500);
      this.emit();
      if (this.engines.gpu.available && this.gpu) {
        const probe = await this.gpu.probe(1200);
        if (probe.available) this.engines.gpu.benchRate = probe.benchRate;
      }
    } finally {
      this.benching = false;
      this.emit();
    }
  }

  get isBenching(): boolean {
    return this.benching;
  }

  setGpuEnabled(on: boolean): void {
    if (!this.engines.gpu.available) return;
    this.engines.gpu.enabled = on;
    this.emit();
  }

  async setWorkers(n: number): Promise<void> {
    n = Math.max(1, Math.min(n, this.maxWorkers));
    this.workersWanted = n;
    if (this.status === 'running' || this.status === 'paused') {
      this.engines.cpu.workers = n;
      this.emit();
      return;
    }
    await this.pool.setSize(n);
    this.engines.cpu.workers = n;
    this.emit();
  }

  /** Rate estimate used before a run starts, from benchmarks. */
  estimatedRate(): number | null {
    const cpu = this.engines.cpu.benchRate;
    if (cpu == null) return null;
    const perWorker = cpu / Math.max(1, this.pool.size);
    let rate = perWorker * this.workersWanted;
    if (this.engines.gpu.enabled && this.engines.gpu.benchRate) rate += this.engines.gpu.benchRate;
    return rate;
  }

  async start(job: Job): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return;
    this.job = job;
    this.seenSecrets.clear();
    this.error = null;
    this.cpuAttempts = 0;
    this.gpuAttempts = 0;
    this.accumulatedMs = 0;
    this.rateWindow = [];
    this.cpuLive = 0;
    this.gpuLive = 0;
    this.sample = null;
    this.status = 'starting';
    this.emit();
    try {
      if (this.pool.size !== this.workersWanted) await this.pool.setSize(this.workersWanted);
      this.pool.start(job, this.workersWanted);
      if (this.engines.gpu.enabled && this.gpu) {
        await this.gpu.start(job);
      }
      this.runStart = performance.now();
      this.status = 'running';
      this.emit();
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.pool.pause();
    this.gpu?.pause();
    this.accumulatedMs += performance.now() - this.runStart;
    this.status = 'paused';
    this.emit();
  }

  resume(): void {
    if ((this.status !== 'paused' && this.status !== 'found') || !this.job) return;
    this.pool.resume();
    if (this.engines.gpu.enabled) this.gpu?.resume(this.job);
    this.runStart = performance.now();
    this.rateWindow = [];
    this.status = 'running';
    this.emit();
  }

  stop(): void {
    this.pool.stop();
    this.gpu?.stop();
    if (this.status === 'running') this.accumulatedMs += performance.now() - this.runStart;
    this.status = 'idle';
    this.job = null;
    this.emit();
  }

  clearResults(): void {
    this.results = [];
    this.emit();
  }

  private fail(message: string): void {
    this.error = message;
    this.status = 'error';
    this.pool.stop();
    this.gpu?.stop();
    this.emit();
  }

  private disableGpu(reason: string): void {
    this.engines.gpu.enabled = false;
    this.engines.gpu.available = false;
    this.engines.gpu.error = reason;
    this.gpu?.stop();
    this.emit();
  }

  /** Independent verification with @noble before anything is shown. */
  private onCandidate(c: Candidate): void {
    const job = this.job;
    if (!job || (this.status !== 'running' && this.status !== 'starting')) return;
    const p = normalizePattern(job.pattern);
    let address: string;
    let kind: SearchResult['kind'];
    try {
      if (job.kind === 'address' && job.base) {
        address = splitKeyAddress(job.base, c.key);
        kind = 'split';
      } else if (job.kind === 'address') {
        address = privateKeyToAddress(c.key);
        kind = 'address';
      } else {
        address = create2Address(job.deployer, c.key, job.initCodeHash);
        kind = 'create2';
      }
    } catch (e) {
      this.recordVerificationFailure(c, `derivation threw: ${(e as Error).message}`);
      return;
    }
    const checksummed = toChecksum(address);
    const kernelAddr = c.address.length === 20 ? bytesToHex(c.address) : null;
    if ((kernelAddr && kernelAddr !== address) || !matchesPattern(address, checksummed, p)) {
      this.recordVerificationFailure(c, 'address does not match the pattern after independent re-derivation');
      return;
    }
    const secret = bytesToHex(c.key);
    if (this.seenSecrets.has(secret)) return;
    this.seenSecrets.add(secret);
    const result: SearchResult = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      address,
      checksummed,
      secret,
      engine: c.engine,
      attempts: this.cpuAttempts + this.gpuAttempts,
      foundAt: Date.now(),
      pattern: job.pattern,
    };
    this.results = [result, ...this.results];
    // auto-pause so the machine stops burning once we have a match
    this.pool.pause();
    this.gpu?.pause();
    if (this.status === 'running') this.accumulatedMs += performance.now() - this.runStart;
    this.status = 'found';
    this.emit();
  }

  private recordVerificationFailure(c: Candidate, why: string): void {
    this.verificationFailures++;
    console.error('[0xCairn] candidate failed verification:', why, c.engine);
    if (c.engine === 'gpu') this.disableGpu('GPU result failed independent verification; GPU disabled for this session.');
    this.emit();
  }

  private updateRates(): void {
    const now = performance.now();
    this.rateWindow.push({ t: now, cpu: this.cpuAttempts, gpu: this.gpuAttempts });
    while (this.rateWindow.length > 2 && now - this.rateWindow[0].t > 3000) this.rateWindow.shift();
    const first = this.rateWindow[0];
    const dt = (now - first.t) / 1000;
    if (dt > 0.3) {
      this.cpuLive = Math.max(0, (this.cpuAttempts - first.cpu) / dt);
      this.gpuLive = Math.max(0, (this.gpuAttempts - first.gpu) / dt);
    }
  }

  private scheduleEmit(): void {
    if (this.emitTimer != null) return;
    this.emitTimer = window.setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, 120);
  }

  private emit(): void {
    if (this.status === 'running') this.updateRates();
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  snapshot(): SearchSnapshot {
    const running = this.status === 'running';
    const elapsed = this.accumulatedMs + (running ? performance.now() - this.runStart : 0);
    const rate = running ? this.cpuLive + this.gpuLive : 0;
    return {
      status: this.status,
      job: this.job,
      attempts: this.cpuAttempts + this.gpuAttempts,
      rate,
      elapsedMs: elapsed,
      results: this.results,
      error: this.error,
      verificationFailures: this.verificationFailures,
      sample: this.sample,
      engines: {
        cpu: { ...this.engines.cpu, workers: this.workersWanted, liveRate: running ? this.cpuLive : 0 },
        gpu: { ...this.engines.gpu, liveRate: running ? this.gpuLive : 0 },
      },
    };
  }
}

/** "apple apple metal-3" -> "Apple GPU (Metal 3)"; "nvidia ..." -> "NVIDIA GPU"; dedupes repeated words. */
export function formatGpuName(raw: string): string {
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const uniq = [...new Set(words)];
  if (!uniq.length) return '';
  const vendorMap: Record<string, string> = { apple: 'Apple', nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', qualcomm: 'Qualcomm', arm: 'Arm', google: 'Google' };
  const vendor = uniq.map((w) => vendorMap[w]).find(Boolean);
  const rest = uniq.filter((w) => !vendorMap[w] && !['gpu', 'inc', 'corporation', 'corp'].includes(w)).map((w) => w.replace(/-(\d)/, ' $1'));
  const detail = rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (vendor) return detail ? `${vendor} GPU (${detail})` : `${vendor} GPU`;
  return detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : 'WebGPU device';
}
