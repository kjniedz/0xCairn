/**
 * WebGPU host driver for kernel.wgsl. DOM-free: runs in the browser and in Deno.
 *
 * The GPU only ever sees public points (address mode) or salts (CREATE2 mode).
 * It reports (index, round) pairs; the caller turns those into keys and must
 * re-verify every candidate with an independent implementation (see eth.ts).
 */
import type { PackedPattern } from '../lib/pattern';

export const MAX_RESULTS = 256;
const PARAM_WORDS = 76;
const OFF = {
  rounds: 0,
  roundBase: 1,
  threads: 2,
  caseSensitive: 3,
  mask: 4,
  value: 9,
  upperLo: 14,
  upperHi: 15,
  lowerLo: 16,
  lowerHi: 17,
  delta: 18,
  block: 34,
  saltBase: 68,
} as const;

export interface GpuHit {
  idx: number;
  round: number;
}

export interface GpuStepResult {
  hits: GpuHit[];
  attempts: number;
  /** True if more matches occurred than the result buffer could hold. */
  overflow: boolean;
  ms: number;
}

export interface GpuEngineOptions {
  /** Points per invocation in address mode. */
  K?: number;
  /** Total invocations (multiple of 64). */
  threads?: number;
}

export interface GpuDescription {
  vendor: string;
  architecture: string;
  description: string;
}

function limbsOf(v: bigint, out: Uint32Array, offset: number): void {
  for (let l = 0; l < 8; l++) {
    out[offset + l] = Number((v >> BigInt(32 * l)) & 0xffffffffn);
  }
}

/** Convert WASM lane export (big-endian x||y, 64 bytes per point) to LE u32 limbs. */
export function lanesToLimbs(lanes: Uint8Array): Uint32Array {
  const n = lanes.length / 64;
  const out = new Uint32Array(n * 16);
  const dv = new DataView(lanes.buffer, lanes.byteOffset, lanes.byteLength);
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 2; c++) {
      for (let l = 0; l < 8; l++) {
        out[p * 16 + c * 8 + l] = dv.getUint32(p * 64 + c * 32 + 28 - 4 * l, false);
      }
    }
  }
  return out;
}

export class GpuEngine {
  readonly K: number;
  readonly threads: number;
  private params = new Uint32Array(PARAM_WORDS);
  private paramBuf: GPUBuffer;
  private resultBuf: GPUBuffer;
  private stagingBuf: GPUBuffer;
  private pointsBuf: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private roundBase = 0;
  private mode: 'address' | 'create2' | null = null;
  private zeroResults: Uint32Array;
  private destroyed = false;
  readonly device: GPUDevice;
  readonly info: GpuDescription;
  private readonly module: GPUShaderModule;
  private readonly layout: GPUBindGroupLayout;
  private readonly pipelineLayout: GPUPipelineLayout;

  private constructor(
    device: GPUDevice,
    info: GpuDescription,
    module: GPUShaderModule,
    layout: GPUBindGroupLayout,
    pipelineLayout: GPUPipelineLayout,
    K: number,
    threads: number,
  ) {
    this.device = device;
    this.info = info;
    this.module = module;
    this.layout = layout;
    this.pipelineLayout = pipelineLayout;
    this.K = K;
    this.threads = threads;
    this.paramBuf = device.createBuffer({
      size: PARAM_WORDS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const resultBytes = (1 + 2 * MAX_RESULTS) * 4 + 4;
    this.resultBuf = device.createBuffer({
      size: resultBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.stagingBuf = device.createBuffer({
      size: resultBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.zeroResults = new Uint32Array(resultBytes / 4);
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
  }

  static async create(shaderSource: string, opts: GpuEngineOptions = {}): Promise<GpuEngine | null> {
    if (!GpuEngine.supported()) return null;
    const gpu = (navigator as Navigator & { gpu: GPU }).gpu;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const K = opts.K ?? 8;
    const threads = opts.threads ?? 16384;
    if (threads % 64 !== 0) throw new Error('threads must be a multiple of 64');
    const pointsBytes = threads * K * 64;
    const limits = adapter.limits;
    if (pointsBytes > limits.maxStorageBufferBindingSize || pointsBytes > limits.maxBufferSize) {
      return null;
    }
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(limits.maxStorageBufferBindingSize, Math.max(pointsBytes, 128 * 1024 * 1024)),
        maxBufferSize: Math.min(limits.maxBufferSize, Math.max(pointsBytes, 128 * 1024 * 1024)),
      },
    });
    const a = adapter as GPUAdapter & { info?: GPUAdapterInfo };
    const info: GpuDescription = {
      vendor: a.info?.vendor ?? '',
      architecture: a.info?.architecture ?? '',
      description: a.info?.description ?? '',
    };
    const module = device.createShaderModule({ code: shaderSource.replace('__K__', `${K}u`) });
    const compInfo = await module.getCompilationInfo();
    const errors = compInfo.messages.filter((m) => m.type === 'error');
    if (errors.length) {
      device.destroy();
      throw new Error('WGSL compile error: ' + errors.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
    }
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    return new GpuEngine(device, info, module, layout, pipelineLayout, K, threads);
  }

  /** Number of keys examined per round. */
  get keysPerRound(): number {
    return this.mode === 'create2' ? this.threads : this.threads * this.K;
  }

  private writePattern(p: PackedPattern): void {
    this.params.set(p.mask, OFF.mask);
    this.params.set(p.value, OFF.value);
    this.params[OFF.upperLo] = p.upperLo;
    this.params[OFF.upperHi] = p.upperHi;
    this.params[OFF.lowerLo] = p.lowerLo;
    this.params[OFF.lowerHi] = p.lowerHi;
    this.params[OFF.caseSensitive] = p.caseSensitive ? 1 : 0;
  }

  private async setPipeline(entry: 'address_main' | 'create2_main'): Promise<void> {
    this.pipeline = await this.device.createComputePipelineAsync({
      layout: this.pipelineLayout,
      compute: { module: this.module, entryPoint: entry },
    });
  }

  private ensurePoints(bytes: number): GPUBuffer {
    if (!this.pointsBuf || this.pointsBuf.size < bytes) {
      this.pointsBuf?.destroy();
      this.pointsBuf = this.device.createBuffer({
        size: Math.max(bytes, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    return this.pointsBuf;
  }

  private rebind(): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: this.pointsBuf! } },
        { binding: 2, resource: { buffer: this.resultBuf } },
      ],
    });
  }

  /**
   * Start an address search. `lanes` is the WASM export of threads*K points
   * (S + i*G), `delta` = (threads*K)*G.
   */
  async beginAddress(lanes: Uint8Array, delta: { x: bigint; y: bigint }, pattern: PackedPattern): Promise<void> {
    if (lanes.length !== this.threads * this.K * 64) {
      throw new Error(`expected ${this.threads * this.K} lane points`);
    }
    this.mode = 'address';
    this.roundBase = 0;
    this.params.fill(0);
    this.params[OFF.threads] = this.threads;
    this.writePattern(pattern);
    limbsOf(delta.x, this.params, OFF.delta);
    limbsOf(delta.y, this.params, OFF.delta + 8);
    const limbs = lanesToLimbs(lanes);
    const buf = this.ensurePoints(limbs.byteLength);
    this.device.queue.writeBuffer(buf, 0, limbs);
    this.device.queue.writeBuffer(this.paramBuf, 0, this.params);
    this.device.queue.writeBuffer(this.resultBuf, 0, this.zeroResults);
    this.rebind();
    await this.setPipeline('address_main');
  }

  async beginCreate2(deployer: Uint8Array, initCodeHash: Uint8Array, saltBase: Uint8Array, pattern: PackedPattern): Promise<void> {
    this.mode = 'create2';
    this.roundBase = 0;
    this.params.fill(0);
    this.params[OFF.threads] = this.threads;
    this.writePattern(pattern);
    // 136-byte block: 0xff || deployer(20) || salt(32, zero) || initCodeHash(32) || pad
    const block = new Uint8Array(136);
    block[0] = 0xff;
    block.set(deployer, 1);
    block.set(initCodeHash, 53);
    block[85] = 0x01;
    block[135] |= 0x80;
    for (let i = 0; i < 136; i++) this.params[OFF.block + (i >> 2)] |= block[i] << (8 * (i & 3));
    const dv = new DataView(saltBase.buffer, saltBase.byteOffset, 32);
    for (let w = 0; w < 8; w++) this.params[OFF.saltBase + w] = dv.getUint32(w * 4, false);
    this.ensurePoints(16);
    this.device.queue.writeBuffer(this.paramBuf, 0, this.params);
    this.device.queue.writeBuffer(this.resultBuf, 0, this.zeroResults);
    this.rebind();
    await this.setPipeline('create2_main');
  }

  /** Run `rounds` rounds and collect hits. */
  async step(rounds: number): Promise<GpuStepResult> {
    if (!this.pipeline || !this.bindGroup || !this.mode) throw new Error('engine not started');
    if (this.destroyed) throw new Error('engine destroyed');
    const t0 = performance.now();
    const head = new Uint32Array([rounds, this.roundBase]);
    this.device.queue.writeBuffer(this.paramBuf, 0, head);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(this.threads / 64);
    pass.end();
    enc.copyBufferToBuffer(this.resultBuf, 0, this.stagingBuf, 0, this.stagingBuf.size);
    this.device.queue.submit([enc.finish()]);
    await this.stagingBuf.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this.stagingBuf.getMappedRange().slice(0));
    this.stagingBuf.unmap();
    const count = data[0];
    const hits: GpuHit[] = [];
    const n = Math.min(count, MAX_RESULTS);
    for (let i = 0; i < n; i++) hits.push({ idx: data[1 + 2 * i], round: data[2 + 2 * i] });
    if (count > 0) this.device.queue.writeBuffer(this.resultBuf, 0, this.zeroResults);
    const startRound = this.roundBase;
    this.roundBase = (this.roundBase + rounds) >>> 0;
    void startRound;
    return {
      hits,
      attempts: rounds * this.keysPerRound,
      overflow: count > MAX_RESULTS,
      ms: performance.now() - t0,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointsBuf?.destroy();
    this.paramBuf.destroy();
    this.resultBuf.destroy();
    this.stagingBuf.destroy();
    this.device.destroy();
  }
}
