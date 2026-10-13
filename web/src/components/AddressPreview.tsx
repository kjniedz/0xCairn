import { useEffect, useRef, useState } from 'preact/hooks';
import type { Pattern } from '../lib/pattern';
import { normalizePattern } from '../lib/pattern';
import { bytesToHex, toChecksum } from '../lib/eth';
import type { SearchStatus } from '../engine/types';

interface Props {
  pattern: Pattern;
  status: SearchStatus;
  /** Latest candidate from the engines (20 bytes). */
  sample: Uint8Array | null;
  /** Checksummed 40-char address once found. */
  found: string | null;
  attempts: number;
}

const PLACEHOLDER = '·';
const MIN_INTERVAL_MS = 220;

/**
 * The hero element: a large live address preview. Pattern characters stay
 * fixed and lit; the rest shows dim placeholders before a run, cycles through
 * recently checked candidates during a run, and settles on the real address
 * when a match is found.
 */
export function AddressPreview({ pattern, status, sample, found, attempts }: Props) {
  const p = normalizePattern(pattern);
  const [live, setLive] = useState<string | null>(null);
  const lastRef = useRef(0);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (status !== 'running' || !sample) return;
    const now = performance.now();
    if (now - lastRef.current < (reduced ? 900 : MIN_INTERVAL_MS)) return;
    lastRef.current = now;
    const hex = bytesToHex(sample);
    setLive(p.caseSensitive ? toChecksum(hex) : hex);
  }, [sample, status, p.caseSensitive, reduced]);

  useEffect(() => {
    if (status === 'idle') setLive(null);
  }, [status]);

  const settled = status === 'found' && found;
  const source = settled ? found : live;
  const chars: Array<{ ch: string; cls: string }> = [];
  for (let i = 0; i < 40; i++) {
    const inPrefix = i < p.prefix.length;
    const inSuffix = i >= 40 - p.suffix.length;
    if (settled) {
      chars.push({ ch: found![i], cls: inPrefix || inSuffix ? 'c fixed' : 'c' });
    } else if (inPrefix) {
      chars.push({ ch: p.prefix[i], cls: 'c fixed' });
    } else if (inSuffix) {
      chars.push({ ch: p.suffix[i - (40 - p.suffix.length)], cls: 'c fixed' });
    } else if (source) {
      chars.push({ ch: source[i], cls: 'c live' });
    } else {
      chars.push({ ch: PLACEHOLDER, cls: 'c' });
    }
  }
  const half1 = chars.slice(0, 20);
  const half2 = chars.slice(20);
  const cls = `preview-addr ${settled ? 'settled' : ''} ${status === 'running' ? 'mining' : ''}`;
  const empty = p.prefix.length + p.suffix.length === 0;

  return (
    <div class="preview-wrap" aria-live="off">
      <div class={cls} key={settled ? found : 'live'}>
        <span class="half">
          <span class="c">0</span>
          <span class="c">x</span>
          {half1.map((c, i) => (
            <span class={c.cls} key={i}>
              {c.ch}
            </span>
          ))}
        </span>
        <span class="half">
          {half2.map((c, i) => (
            <span class={c.cls} key={i + 20}>
              {c.ch}
            </span>
          ))}
        </span>
      </div>
      <div class="preview-caption">
        {settled
          ? 'Your address. Verified twice, never sent anywhere.'
          : status === 'running'
            ? `Checking candidates on your device · ${attempts > 0 ? attempts.toLocaleString('en-US') + ' tried' : 'warming up'}`
            : empty
              ? 'Type a prefix or suffix below and watch it take its place.'
              : 'Your pattern, in position. Press Start to carve the rest.'}
      </div>
    </div>
  );
}
