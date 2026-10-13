/**
 * Manages one mining Web Worker per CPU core and aggregates their progress.
 */
import type { Candidate, Job, WorkerIn, WorkerOut, WorkerJob } from './types';
import { normalizePattern, hasMask } from '../lib/pattern';
import { hexToBytes } from '../lib/eth';

export const LANES_PER_WORKER = 512;

interface Slot {
  worker: Worker;
  attempts: number;
  ready: boolean;
}

export class CpuPool {
  private slots: Slot[] = [];
  onFound: ((c: Candidate, attempts: number) => void) | null = null;
  onProgress: ((attempts: number, sample?: Uint8Array) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private active = 0;

  get size(): number {
    return this.slots.length;
  }

  get attempts(): number {
    let total = 0;
    for (const s of this.slots) total += s.attempts;
    return total;
  }

  /** Create or resize the pool. Returns when every worker has loaded the kernel. */
  async setSize(n: number): Promise<void> {
    n = Math.max(1, Math.min(n, 64));
    while (this.slots.length > n) {
      const s = this.slots.pop()!;
      s.worker.terminate();
    }
    const pending: Promise<void>[] = [];
    while (this.slots.length < n) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, attempts: 0, ready: false };
      this.slots.push(slot);
      pending.push(
        new Promise<void>((resolve, reject) => {
          const onMsg = (e: MessageEvent<WorkerOut>) => {
            if (e.data.type === 'ready') {
              slot.ready = true;
              worker.removeEventListener('message', onMsg);
              resolve();
            } else if (e.data.type === 'error') {
              reject(new Error(e.data.message));
            }
          };
          worker.addEventListener('message', onMsg);
          worker.addEventListener('error', (ev) => reject(new Error(ev.message || 'worker failed to load')));
        }),
      );
      worker.addEventListener('message', (e: MessageEvent<WorkerOut>) => this.handle(slot, e.data));
      this.send(worker, { type: 'init' });
    }
    await Promise.all(pending);
  }

  private send(w: Worker, m: WorkerIn): void {
    w.postMessage(m);
  }

  private handle(slot: Slot, m: WorkerOut): void {
    switch (m.type) {
      case 'progress':
        slot.attempts = m.attempts;
        this.onProgress?.(this.attempts, m.sample);
        break;
      case 'found':
        slot.attempts = m.attempts;
        this.onFound?.({ key: m.key, address: m.address, engine: 'cpu' }, this.attempts);
        break;
      case 'error':
        this.onError?.(m.message);
        break;
      case 'bench':
        break;
      case 'ready':
        break;
    }
  }

  /** Measures aggregate throughput with every worker busy for `ms`. */
  async bench(ms = 500): Promise<number> {
    const rates = await Promise.all(
      this.slots.map(
        (s) =>
          new Promise<number>((resolve) => {
            const onMsg = (e: MessageEvent<WorkerOut>) => {
              if (e.data.type === 'bench') {
                s.worker.removeEventListener('message', onMsg);
                resolve(e.data.rate);
              }
            };
            s.worker.addEventListener('message', onMsg);
            this.send(s.worker, { type: 'bench', ms });
          }),
      ),
    );
    return rates.reduce((a, b) => a + b, 0);
  }

  start(job: Job, workers?: number): void {
    const n = Math.min(workers ?? this.slots.length, this.slots.length);
    this.active = n;
    const p = normalizePattern(job.pattern);
    const mask = hasMask(p) ? hexToBytes(p.mask!) : undefined;
    const value = hasMask(p) ? hexToBytes(p.value!) : undefined;
    const base: WorkerJob =
      job.kind === 'address'
        ? { kind: 'address', prefix: p.prefix, suffix: p.suffix, caseSensitive: p.caseSensitive, mask, value, base: job.base, lanes: LANES_PER_WORKER }
        : { kind: 'create2', prefix: p.prefix, suffix: p.suffix, caseSensitive: p.caseSensitive, mask, value, deployer: job.deployer, initCodeHash: job.initCodeHash };
    this.slots.forEach((s, i) => {
      s.attempts = 0;
      if (i < n) this.send(s.worker, { type: 'start', job: base });
    });
  }

  pause(): void {
    for (let i = 0; i < this.active; i++) this.send(this.slots[i].worker, { type: 'pause' });
  }

  resume(): void {
    for (let i = 0; i < this.active; i++) this.send(this.slots[i].worker, { type: 'resume' });
  }

  stop(): void {
    for (const s of this.slots) this.send(s.worker, { type: 'stop' });
    this.active = 0;
  }

  destroy(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
  }
}
