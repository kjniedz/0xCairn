/**
 * Thin typed wrapper around the Rust/WASM mining kernel (kernel/src/lib.rs).
 * DOM-free so it runs in Web Workers, the main thread, Node and Deno.
 */

export interface KernelExports {
  memory: WebAssembly.Memory;
  io_ptr(): number;
  io_len(): number;
  set_pattern(prefixLen: number, suffixLen: number, caseSensitive: number): number;
  miner_init(lanes: number, hasBase: number): number;
  miner_mine(rounds: number): number;
  miner_attempts(): number;
  miner_lanes(): number;
  miner_found(): number;
  miner_export_lanes(): number;
  derive_address(): number;
  create2_init(): number;
  create2_mine(count: number): number;
  create2_attempts(): number;
  create2_found(): number;
}

export interface Found {
  /** Private key, or the scalar offset in split-key mode, or the salt in CREATE2 mode. */
  key: Uint8Array;
  address: Uint8Array;
}

const INIT_ERRORS: Record<number, string> = {
  1: 'invalid seed scalar',
  2: 'invalid base public key',
  3: 'invalid lane count',
};

export class Kernel {
  private readonly ex: KernelExports;

  private constructor(ex: KernelExports) {
    this.ex = ex;
  }

  static async load(source: BufferSource | WebAssembly.Module | Response | PromiseLike<Response>): Promise<Kernel> {
    let instance: WebAssembly.Instance;
    if (source instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(source, {});
    } else if (source instanceof Response || (source && typeof (source as PromiseLike<Response>).then === 'function')) {
      const r = await WebAssembly.instantiateStreaming(source as Response | PromiseLike<Response>, {});
      instance = r.instance;
    } else {
      const r = await WebAssembly.instantiate(source as BufferSource, {});
      instance = r.instance;
    }
    return new Kernel(instance.exports as unknown as KernelExports);
  }

  private io(): Uint8Array {
    const ptr = this.ex.io_ptr();
    return new Uint8Array(this.ex.memory.buffer, ptr, this.ex.io_len());
  }

  setPattern(prefix: string, suffix: string, caseSensitive: boolean): void {
    const io = this.io();
    const enc = new TextEncoder();
    const p = enc.encode(prefix);
    const s = enc.encode(suffix);
    io.set(p, 0);
    io.set(s, p.length);
    const rc = this.ex.set_pattern(p.length, s.length, caseSensitive ? 1 : 0);
    if (rc !== 0) throw new Error('invalid pattern');
  }

  /** seed: 32-byte big-endian scalar. base: optional 65-byte uncompressed public key. */
  minerInit(seed: Uint8Array, lanes: number, base?: Uint8Array): void {
    if (seed.length !== 32) throw new Error('seed must be 32 bytes');
    const io = this.io();
    io.set(seed, 0);
    if (base) {
      if (base.length !== 65) throw new Error('base public key must be 65 bytes (uncompressed)');
      io.set(base, 32);
    }
    const rc = this.ex.miner_init(lanes, base ? 1 : 0);
    if (rc !== 0) throw new Error(`miner_init failed: ${INIT_ERRORS[rc] ?? rc}`);
  }

  mine(rounds: number): boolean {
    const rc = this.ex.miner_mine(rounds);
    if (rc === 2) throw new Error('miner not initialised');
    return rc === 1;
  }

  attempts(): number {
    return this.ex.miner_attempts();
  }

  lanes(): number {
    return this.ex.miner_lanes();
  }

  found(): Found | null {
    if (this.ex.miner_found() !== 1) return null;
    const io = this.io();
    return { key: io.slice(0, 32), address: io.slice(32, 52) };
  }

  /** All lane points as big-endian x||y, 64 bytes per lane (copied out of WASM memory). */
  exportLanes(): Uint8Array {
    const ptr = this.ex.miner_export_lanes();
    const n = this.ex.miner_lanes();
    return new Uint8Array(this.ex.memory.buffer, ptr, n * 64).slice();
  }

  deriveAddress(key: Uint8Array): { address: Uint8Array; publicKey: Uint8Array } {
    if (key.length !== 32) throw new Error('key must be 32 bytes');
    const io = this.io();
    io.set(key, 0);
    const rc = this.ex.derive_address();
    if (rc !== 0) throw new Error('invalid private key');
    return { address: io.slice(32, 52), publicKey: io.slice(52, 117) };
  }

  create2Init(deployer: Uint8Array, initCodeHash: Uint8Array, saltSeed: Uint8Array): void {
    if (deployer.length !== 20 || initCodeHash.length !== 32 || saltSeed.length !== 32) {
      throw new Error('create2Init: bad argument lengths');
    }
    const io = this.io();
    io.set(deployer, 0);
    io.set(initCodeHash, 20);
    io.set(saltSeed, 52);
    this.ex.create2_init();
  }

  create2Mine(count: number): boolean {
    const rc = this.ex.create2_mine(count);
    if (rc === 2) throw new Error('create2 not initialised');
    return rc === 1;
  }

  create2Attempts(): number {
    return this.ex.create2_attempts();
  }

  create2Found(): Found | null {
    if (this.ex.create2_found() !== 1) return null;
    const io = this.io();
    return { key: io.slice(0, 32), address: io.slice(32, 52) };
  }
}
