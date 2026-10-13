/**
 * Ethereum helpers built on @noble (audited, pure JS). This is the
 * *independent* implementation used to re-verify everything the WASM and GPU
 * kernels report before it is shown to the user.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, concatBytes };

export const CURVE_N: bigint = secp256k1.Point.Fn.ORDER;

export function bytesToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

export function bigIntToBytes32(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 256n) throw new Error('value out of range');
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

/** Uniform random scalar in [1, n-1] from crypto.getRandomValues, full 256 bits. */
export function randomScalar(): Uint8Array {
  for (;;) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    const v = bytesToBigInt(b);
    if (v !== 0n && v < CURVE_N) return b;
  }
}

export function randomBytes32(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

export function isValidPrivateKey(key: Uint8Array): boolean {
  if (key.length !== 32) return false;
  const v = bytesToBigInt(key);
  return v !== 0n && v < CURVE_N;
}

/** Lowercase 40-char hex address (no 0x) for a private key. */
export function privateKeyToAddress(key: Uint8Array): string {
  const pub = secp256k1.getPublicKey(key, false);
  return publicKeyToAddress(pub);
}

export function privateKeyToPublicKey(key: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(key, false);
}

/** Lowercase address from a 65-byte uncompressed or 33-byte compressed public key. */
export function publicKeyToAddress(pub: Uint8Array): string {
  const p = secp256k1.Point.fromBytes(pub);
  const unc = p.toBytes(false);
  return bytesToHex(keccak_256(unc.subarray(1)).subarray(12));
}

export function isValidPublicKey(pub: Uint8Array): boolean {
  try {
    secp256k1.Point.fromBytes(pub).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/** EIP-55 checksum. Accepts lowercase hex with or without 0x, returns 40 chars without 0x. */
export function toChecksum(addr: string): string {
  const lower = strip0x(addr).toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '';
  for (let i = 0; i < 40; i++) {
    const c = lower[i];
    out += /[a-f]/.test(c) && parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

export function strip0x(s: string): string {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

export function isAddress(s: string): boolean {
  return /^(0x)?[0-9a-fA-F]{40}$/.test(s);
}

export function isBytes32Hex(s: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(s);
}

/** CREATE2: keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12..] */
export function create2Address(deployer: Uint8Array, salt: Uint8Array, initCodeHash: Uint8Array): string {
  const buf = concatBytes(new Uint8Array([0xff]), deployer, salt, initCodeHash);
  return bytesToHex(keccak_256(buf).subarray(12));
}

/** (a + b) mod n for 32-byte scalars. */
export function addScalars(a: Uint8Array, b: Uint8Array): Uint8Array {
  return bigIntToBytes32(mod(bytesToBigInt(a) + bytesToBigInt(b), CURVE_N));
}

export function addScalarBig(a: Uint8Array, b: bigint): Uint8Array {
  return bigIntToBytes32(mod(bytesToBigInt(a) + b, CURVE_N));
}

/** k * G as affine coordinates. */
export function mulG(k: bigint): { x: bigint; y: bigint } {
  return secp256k1.Point.BASE.multiply(mod(k, CURVE_N)).toAffine();
}

/** Decode a 65-byte uncompressed public key to affine coordinates. */
export function pubToAffine(pub: Uint8Array): { x: bigint; y: bigint } {
  return secp256k1.Point.fromBytes(pub).toAffine();
}

/**
 * Split-key: address of (P + offset*G) where P is the requester's public key.
 * The final private key is (requesterKey + offset) mod n.
 */
export function splitKeyAddress(pub: Uint8Array, offset: Uint8Array): string {
  const P = secp256k1.Point.fromBytes(pub);
  const Q = P.add(secp256k1.Point.BASE.multiply(mod(bytesToBigInt(offset), CURVE_N)));
  return bytesToHex(keccak_256(Q.toBytes(false).subarray(1)).subarray(12));
}

/** Add 256-bit big-endian salt and a bigint offset, wrapping mod 2^256. */
export function addSalt(salt: Uint8Array, offset: bigint): Uint8Array {
  return bigIntToBytes32(mod(bytesToBigInt(salt) + offset, 1n << 256n));
}

export function keccak256Hex(data: Uint8Array): string {
  return bytesToHex(keccak_256(data));
}

export function uuidV4(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
