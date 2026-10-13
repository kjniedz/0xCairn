/**
 * Local result history ("Your cairns"): matches persisted in IndexedDB,
 * encrypted with a user password using the same scrypt + AES-128-CTR +
 * keccak MAC construction as the keystore. Unencrypted key material never
 * touches storage. Opt-in only.
 *
 * Also: run checkpoints (pattern, attempts, elapsed) in localStorage so a
 * refreshed tab can tell the user what was lost. Never key material.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { ctr } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';
import type { Pattern } from './pattern';

const DB = 'cairn';
const STORE = 'cairns';
const OPT_KEY = 'cairn.history.enabled';
const CHECKPOINT_KEY = 'cairn.run.checkpoint';

export interface HistoryEntry {
  id: string;
  /** lowercase hex, no 0x */
  address: string;
  pattern: Pattern;
  kind: 'address' | 'split' | 'create2';
  foundAt: number;
  /** Encrypted secret blob, hex-encoded fields. */
  crypto: { salt: string; iv: string; ciphertext: string; mac: string; n: number };
}

export function historyEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHistoryEnabled(on: boolean): void {
  localStorage.setItem(OPT_KEY, on ? '1' : '0');
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

const N = 1 << 15;

async function derive(password: string, salt: Uint8Array, n: number): Promise<Uint8Array> {
  return scryptAsync(new TextEncoder().encode(password.normalize('NFKC')), salt, { N: n, r: 8, p: 1, dkLen: 32 });
}

export async function saveEntry(secretHex: string, address: string, pattern: Pattern, kind: HistoryEntry['kind'], password: string): Promise<HistoryEntry> {
  const salt = new Uint8Array(32);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  const dk = await derive(password, salt, N);
  const ciphertext = ctr(dk.subarray(0, 16), iv).encrypt(hexToBytes(secretHex));
  const mac = keccak_256(concatBytes(dk.subarray(16, 32), ciphertext));
  const entry: HistoryEntry = {
    id: `${Date.now().toString(36)}-${address.slice(0, 8)}`,
    address,
    pattern: { prefix: pattern.prefix, suffix: pattern.suffix, caseSensitive: pattern.caseSensitive, mask: pattern.mask, value: pattern.value },
    kind,
    foundAt: Date.now(),
    crypto: { salt: bytesToHex(salt), iv: bytesToHex(iv), ciphertext: bytesToHex(ciphertext), mac: bytesToHex(mac), n: N },
  };
  await tx('readwrite', (s) => s.put(entry));
  return entry;
}

export async function unlockEntry(entry: HistoryEntry, password: string): Promise<string> {
  const c = entry.crypto;
  const dk = await derive(password, hexToBytes(c.salt), c.n);
  const ciphertext = hexToBytes(c.ciphertext);
  const mac = keccak_256(concatBytes(dk.subarray(16, 32), ciphertext));
  if (bytesToHex(mac) !== c.mac) throw new Error('wrong password');
  return bytesToHex(ctr(dk.subarray(0, 16), hexToBytes(c.iv)).decrypt(ciphertext));
}

export async function listEntries(): Promise<HistoryEntry[]> {
  const all = await tx<HistoryEntry[]>('readonly', (s) => s.getAll() as IDBRequest<HistoryEntry[]>);
  return all.sort((a, b) => b.foundAt - a.foundAt);
}

export async function deleteEntry(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function wipeAll(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
  localStorage.removeItem(CHECKPOINT_KEY);
  localStorage.removeItem(OPT_KEY);
}

// --- run checkpoints (no key material, ever)

export interface Checkpoint {
  pattern: Pattern;
  kind: 'address' | 'create2';
  attempts: number;
  elapsedMs: number;
  updatedAt: number;
}

export function writeCheckpoint(c: Checkpoint): void {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(c));
  } catch {
    // storage full or disabled; checkpoints are best-effort
  }
}

export function readCheckpoint(): Checkpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Checkpoint;
    if (!c.pattern || typeof c.attempts !== 'number') return null;
    return c;
  } catch {
    return null;
  }
}

export function clearCheckpoint(): void {
  localStorage.removeItem(CHECKPOINT_KEY);
}
