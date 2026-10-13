/**
 * Pattern validation, difficulty math and GPU packing. Pure functions, no DOM.
 */

export interface Pattern {
  prefix: string;
  suffix: string;
  caseSensitive: boolean;
}

export const HEX_RE = /^[0-9a-fA-F]*$/;

/** Returns an error message, or null when the pattern is usable. */
export function validatePattern(p: Pattern): string | null {
  if (!HEX_RE.test(p.prefix)) return 'Prefix may only contain hex characters (0-9, a-f).';
  if (!HEX_RE.test(p.suffix)) return 'Suffix may only contain hex characters (0-9, a-f).';
  if (p.prefix.length + p.suffix.length === 0) return 'Enter a prefix, a suffix, or both.';
  if (p.prefix.length + p.suffix.length > 40) return 'An address only has 40 hex characters.';
  return null;
}

export function normalizePattern(p: Pattern): Pattern {
  return p.caseSensitive
    ? p
    : { prefix: p.prefix.toLowerCase(), suffix: p.suffix.toLowerCase(), caseSensitive: false };
}

export function hexCount(p: Pattern): number {
  return p.prefix.length + p.suffix.length;
}

export function letterCount(p: Pattern): number {
  return (p.prefix + p.suffix).replace(/[^a-fA-F]/g, '').length;
}

/** Expected number of attempts per match. */
export function difficulty(p: Pattern): number {
  const n = hexCount(p);
  const letters = p.caseSensitive ? letterCount(p) : 0;
  return Math.pow(16, n) * Math.pow(2, letters);
}

/** How many times harder case-sensitive matching makes this pattern. */
export function caseMultiplier(p: Pattern): number {
  return Math.pow(2, letterCount(p));
}

/** Probability that at least one match has been found after `attempts` tries. */
export function probability(attempts: number, diff: number): number {
  if (diff <= 0) return 1;
  return 1 - Math.exp(-attempts / diff);
}

/** Attempts needed for a given probability of success. */
export function attemptsForProbability(prob: number, diff: number): number {
  return -Math.log(1 - prob) * diff;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return 'forever';
  if (seconds < 1) return 'under a second';
  const units: [string, number][] = [
    ['year', 365 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  if (seconds > 1000 * 365 * 86400) {
    const years = seconds / (365 * 86400);
    return `${formatBig(years)} years`;
  }
  for (const [name, size] of units) {
    if (seconds >= size) {
      const v = seconds / size;
      const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      return `${rounded} ${name}${rounded === 1 ? '' : 's'}`;
    }
  }
  return 'under a second';
}

export function formatBig(n: number): string {
  if (!isFinite(n)) return 'infinite';
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  if (i === units.length - 1 && n >= 1000) return n.toExponential(2);
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)}${units[i]}`;
}

export function formatRate(perSecond: number): string {
  if (perSecond >= 1e9) return `${(perSecond / 1e9).toFixed(2)} G/s`;
  if (perSecond >= 1e6) return `${(perSecond / 1e6).toFixed(2)} M/s`;
  if (perSecond >= 1e3) return `${(perSecond / 1e3).toFixed(1)} K/s`;
  return `${Math.round(perSecond)} /s`;
}

/**
 * Host-side verification: does this address (40 lowercase hex chars) and its
 * EIP-55 checksummed form satisfy the pattern?
 */
export function matchesPattern(lower40: string, checksummed40: string, p: Pattern): boolean {
  const n = normalizePattern(p);
  if (!lower40.startsWith(n.prefix.toLowerCase())) return false;
  if (!lower40.endsWith(n.suffix.toLowerCase())) return false;
  if (!n.caseSensitive) return true;
  const cs = checksummed40;
  for (let i = 0; i < n.prefix.length; i++) {
    if (isLetter(n.prefix[i]) && n.prefix[i] !== cs[i]) return false;
  }
  const off = 40 - n.suffix.length;
  for (let j = 0; j < n.suffix.length; j++) {
    if (isLetter(n.suffix[j]) && n.suffix[j] !== cs[off + j]) return false;
  }
  return true;
}

function isLetter(c: string): boolean {
  return /[a-fA-F]/.test(c);
}

export interface PackedPattern {
  mask: Uint32Array; // 5 words, bytes packed little-endian (byte b -> word b>>2, shift 8*(b&3))
  value: Uint32Array;
  upperLo: number;
  upperHi: number;
  lowerLo: number;
  lowerHi: number;
  caseSensitive: boolean;
}

/** Pack a pattern into the word layout the WGSL kernel expects. */
export function packForGpu(p: Pattern): PackedPattern {
  const maskBytes = new Uint8Array(20);
  const valueBytes = new Uint8Array(20);
  let upperLo = 0, upperHi = 0, lowerLo = 0, lowerHi = 0;

  const set = (pos: number, ch: string) => {
    const nib = parseInt(ch, 16);
    const byte = pos >> 1;
    if ((pos & 1) === 0) {
      maskBytes[byte] |= 0xf0;
      valueBytes[byte] |= nib << 4;
    } else {
      maskBytes[byte] |= 0x0f;
      valueBytes[byte] |= nib;
    }
    if (p.caseSensitive && isLetter(ch)) {
      const upper = ch === ch.toUpperCase();
      if (pos < 32) {
        if (upper) upperLo |= 1 << pos; else lowerLo |= 1 << pos;
      } else {
        if (upper) upperHi |= 1 << (pos - 32); else lowerHi |= 1 << (pos - 32);
      }
    }
  };
  for (let i = 0; i < p.prefix.length; i++) set(i, p.prefix[i]);
  const off = 40 - p.suffix.length;
  for (let j = 0; j < p.suffix.length; j++) set(off + j, p.suffix[j]);

  const pack = (b: Uint8Array) => {
    const w = new Uint32Array(5);
    for (let i = 0; i < 20; i++) w[i >> 2] |= b[i] << (8 * (i & 3));
    return w;
  };
  return {
    mask: pack(maskBytes),
    value: pack(valueBytes),
    upperLo: upperLo >>> 0,
    upperHi: upperHi >>> 0,
    lowerLo: lowerLo >>> 0,
    lowerHi: lowerHi >>> 0,
    caseSensitive: p.caseSensitive,
  };
}
