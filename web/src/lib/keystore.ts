/**
 * Web3 Secret Storage (V3 keystore) encryption: scrypt + AES-128-CTR + keccak256 MAC.
 * Compatible with geth, MetaMask, ethers and every other EVM wallet that imports JSON keystores.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { ctr } from '@noble/ciphers/aes.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { uuidV4 } from './eth';

export interface KeystoreOptions {
  /** scrypt N. 2^17 is the geth "standard" cost; 2^18 is geth's default. */
  n?: number;
  r?: number;
  p?: number;
  onProgress?: (fraction: number) => void;
}

export async function encryptKeystoreV3(
  privateKey: Uint8Array,
  password: string,
  addressLowerHex: string,
  opts: KeystoreOptions = {},
): Promise<string> {
  if (privateKey.length !== 32) throw new Error('private key must be 32 bytes');
  const n = opts.n ?? 1 << 17;
  const r = opts.r ?? 8;
  const p = opts.p ?? 1;
  const salt = new Uint8Array(32);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const derived = await scryptAsync(new TextEncoder().encode(password.normalize('NFKC')), salt, {
    N: n,
    r,
    p,
    dkLen: 32,
    onProgress: opts.onProgress,
  });
  const encKey = derived.subarray(0, 16);
  const macKey = derived.subarray(16, 32);
  const ciphertext = ctr(encKey, iv).encrypt(privateKey);
  const mac = keccak_256(concatBytes(macKey, ciphertext));

  const json = {
    version: 3,
    id: uuidV4(),
    address: addressLowerHex.replace(/^0x/i, '').toLowerCase(),
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: bytesToHex(ciphertext),
      cipherparams: { iv: bytesToHex(iv) },
      kdf: 'scrypt',
      kdfparams: { dklen: 32, n, p, r, salt: bytesToHex(salt) },
      mac: bytesToHex(mac),
    },
  };
  return JSON.stringify(json, null, 2);
}

/** Decrypts a V3 keystore produced by encryptKeystoreV3 (used for self-tests). */
export async function decryptKeystoreV3(json: string, password: string): Promise<Uint8Array> {
  const ks = JSON.parse(json);
  if (ks.version !== 3 || ks.crypto.kdf !== 'scrypt' || ks.crypto.cipher !== 'aes-128-ctr') {
    throw new Error('unsupported keystore');
  }
  const kp = ks.crypto.kdfparams;
  const derived = await scryptAsync(new TextEncoder().encode(password.normalize('NFKC')), hex(kp.salt), {
    N: kp.n,
    r: kp.r,
    p: kp.p,
    dkLen: kp.dklen,
  });
  const ciphertext = hex(ks.crypto.ciphertext);
  const mac = keccak_256(concatBytes(derived.subarray(16, 32), ciphertext));
  if (bytesToHex(mac) !== ks.crypto.mac) throw new Error('wrong password');
  return ctr(derived.subarray(0, 16), hex(ks.crypto.cipherparams.iv)).decrypt(ciphertext);
}

function hex(s: string): Uint8Array {
  const clean = s.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function keystoreFilename(addressLowerHex: string): string {
  const d = new Date();
  const iso = d.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '.000000000Z');
  return `UTC--${iso}--${addressLowerHex.replace(/^0x/i, '').toLowerCase()}`;
}
