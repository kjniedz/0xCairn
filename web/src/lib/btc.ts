/**
 * Bitcoin payment helpers shared by the API Worker and tests. One static
 * receiving address is used for every order, so each order is given a unique
 * satoshi amount and matched against incoming outputs by exact value.
 */

export interface BtcVout {
  scriptpubkey_address?: string;
  value: number; // sats
}

export interface BtcTx {
  txid: string;
  vout: BtcVout[];
  status: { confirmed: boolean; block_height?: number };
}

export const SATS = 100_000_000n;

/** USD → sats at the given rate, plus a per-order offset of 1..999 sats so concurrent orders never collide. */
export function btcAmountSats(usd: number, btcUsd: number, payIndex: number): bigint {
  const base = BigInt(Math.round((usd / btcUsd) * 1e8));
  const offset = BigInt(((payIndex * 7919) % 999) + 1);
  return base + offset;
}

export function satsToBtcString(sats: bigint): string {
  const whole = sats / SATS;
  const frac = (sats % SATS).toString().padStart(8, '0');
  return `${whole}.${frac}`;
}

export function btcStringToSats(s: string): bigint {
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole || '0') * SATS + BigInt(frac.padEnd(8, '0').slice(0, 8));
}

/**
 * Find a confirmed transaction paying exactly `sats` to `address` whose txid
 * has not already been consumed by another order. Returns the txid or null.
 */
export function matchBtcTx(txs: BtcTx[], address: string, sats: bigint, usedTxids: Set<string>, requireConfirmed = true): string | null {
  for (const tx of txs) {
    if (usedTxids.has(tx.txid)) continue;
    if (requireConfirmed && !tx.status?.confirmed) continue;
    for (const v of tx.vout) {
      if (v.scriptpubkey_address === address && BigInt(v.value) === sats) return tx.txid;
    }
  }
  return null;
}

export function isBech32Address(a: string): boolean {
  return /^(bc1)[02-9ac-hj-np-z]{11,87}$/.test(a.toLowerCase());
}
