import type { Pattern } from '../lib/pattern';

export interface AddressJob {
  kind: 'address';
  pattern: Pattern;
  /** Split-key mode: 65-byte uncompressed public key supplied by the requester. */
  base?: Uint8Array;
}

export interface Create2Job {
  kind: 'create2';
  pattern: Pattern;
  deployer: Uint8Array;
  initCodeHash: Uint8Array;
}

export type Job = AddressJob | Create2Job;

export type EngineName = 'cpu' | 'gpu' | 'local';

/** Raw candidate from an engine. `key` is a private key, a split-key offset or a CREATE2 salt. */
export interface Candidate {
  key: Uint8Array;
  address: Uint8Array;
  engine: EngineName;
}

export type WorkerJob =
  | { kind: 'address'; prefix: string; suffix: string; caseSensitive: boolean; base?: Uint8Array; lanes: number }
  | { kind: 'create2'; prefix: string; suffix: string; caseSensitive: boolean; deployer: Uint8Array; initCodeHash: Uint8Array };

export type WorkerIn =
  | { type: 'init' }
  | { type: 'start'; job: WorkerJob }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'bench'; ms: number };

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'progress'; attempts: number }
  | { type: 'found'; key: Uint8Array; address: Uint8Array; attempts: number }
  | { type: 'bench'; rate: number }
  | { type: 'error'; message: string };

export type SearchStatus = 'idle' | 'starting' | 'running' | 'paused' | 'found' | 'error';

export interface SearchResult {
  id: string;
  kind: 'address' | 'split' | 'create2';
  /** lowercase hex, no 0x */
  address: string;
  checksummed: string;
  /** hex, no 0x. Private key (address), offset (split) or salt (create2). */
  secret: string;
  engine: EngineName;
  attempts: number;
  foundAt: number;
  pattern: Pattern;
}

export interface EngineStats {
  cpu: {
    workers: number;
    ready: boolean;
    benchRate: number | null;
    liveRate: number;
  };
  gpu: {
    supported: boolean;
    available: boolean;
    enabled: boolean;
    checking: boolean;
    description: string;
    benchRate: number | null;
    liveRate: number;
    error: string | null;
  };
}

export interface SearchSnapshot {
  status: SearchStatus;
  job: Job | null;
  attempts: number;
  rate: number;
  elapsedMs: number;
  results: SearchResult[];
  error: string | null;
  verificationFailures: number;
  engines: EngineStats;
}
