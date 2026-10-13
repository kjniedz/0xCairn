/**
 * Cairn Pro / Teams pricing. Shared by the API Worker and the /pro page so the
 * quote the user sees is exactly what the server charges. Price is based on
 * expected work (difficulty / rig throughput), never on guaranteed time.
 */
import { difficulty as patternDifficulty, type Pattern } from './pattern';

export const PRO = {
  /** Sustained keys/s of one rented GPU rig running our kernel. Conservative. */
  rigKeysPerSec: 400e6,
  /** What we charge per expected rig-hour, margin included. */
  usdPerRigHour: 4,
  minUsd: 9,
  /** Jobs above this many expected hours are declined online; Teams handles them by contact. */
  maxExpectedHours: 2000,
  /** Full refund on request once a job has run past this multiple of its estimate. */
  refundMultiple: 5,
  quoteValidMinutes: 30,
  /** Orders unpaid after this long expire. */
  paymentWindowHours: 24,
} as const;

export interface Quote {
  difficulty: number;
  expectedSeconds: number;
  seconds50: number;
  seconds90: number;
  expectedHours: number;
  usd: number;
  tooLarge: boolean;
}

export function quoteForDifficulty(diff: number): Quote {
  const expectedSeconds = diff / PRO.rigKeysPerSec;
  const expectedHours = expectedSeconds / 3600;
  const raw = expectedHours * PRO.usdPerRigHour;
  const usd = Math.max(PRO.minUsd, Math.ceil(raw * 2) / 2);
  return {
    difficulty: diff,
    expectedSeconds,
    seconds50: expectedSeconds * Math.LN2,
    seconds90: expectedSeconds * Math.log(10),
    expectedHours,
    usd,
    tooLarge: expectedHours > PRO.maxExpectedHours,
  };
}

export function quoteForPattern(p: Pattern): Quote {
  return quoteForDifficulty(patternDifficulty(p));
}

/** Difficulty for a bit-mask target: 2^(number of constrained bits). */
export function maskDifficulty(maskHex: string): number {
  let bits = 0;
  for (const ch of maskHex.toLowerCase()) {
    const v = parseInt(ch, 16);
    if (Number.isNaN(v)) continue;
    bits += ((v & 8) >> 3) + ((v & 4) >> 2) + ((v & 2) >> 1) + (v & 1);
  }
  return Math.pow(2, bits);
}

/** Example tiers for the pricing table, by fixed hex characters. */
export function tierTable(): Array<{ chars: number; quote: Quote }> {
  return [7, 8, 9, 10, 11, 12].map((chars) => ({ chars, quote: quoteForDifficulty(Math.pow(16, chars)) }));
}
