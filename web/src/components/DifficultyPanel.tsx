import type { Pattern } from '../lib/pattern';
import { difficulty, hexCount, letterCount, formatBig, formatDuration, formatRate, validatePattern } from '../lib/pattern';

interface Props {
  pattern: Pattern;
  /** Attempts per second: live rate while running, benchmark estimate otherwise. */
  rate: number | null;
  live: boolean;
}

const DAY = 86400;

export function DifficultyPanel({ pattern, rate, live }: Props) {
  if (hexCount(pattern) === 0 || validatePattern(pattern)) return null;
  const diff = difficulty(pattern);
  const n = hexCount(pattern);
  const letters = pattern.caseSensitive ? letterCount(pattern) : 0;
  const expected = rate && rate > 0 ? diff / rate : null;
  const half = expected != null ? expected * Math.LN2 : null;

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <div class="difficulty">
        <div class="stat">
          <div class="k">Difficulty</div>
          <div class="v">
            1 in {formatBig(diff)}
            <br />
            <small>
              16<sup>{n}</sup>
              {letters > 0 && (
                <>
                  {' '}
                  × 2<sup>{letters}</sup> checksum
                </>
              )}
            </small>
          </div>
        </div>
        <div class="stat">
          <div class="k">Expected time</div>
          <div class="v">
            {expected == null ? '…' : formatDuration(expected)}
            <br />
            <small>{half == null ? 'measuring speed' : `50% chance within ${formatDuration(half)}`}</small>
          </div>
        </div>
        <div class="stat">
          <div class="k">{live ? 'Live speed' : 'Benchmark speed'}</div>
          <div class="v">
            {rate == null ? '…' : formatRate(rate)}
            <br />
            <small>{live ? 'all engines combined' : 'your device, all engines'}</small>
          </div>
        </div>
      </div>
      {expected != null && expected > 365 * DAY && (
        <div class="note danger">
          <b>Realistically out of reach in a browser.</b> This pattern would take about {formatDuration(expected)} on this device. Every character you drop makes it 16× faster. For patterns this long, use split-key mode with a dedicated GPU rig so the miner never sees your key.
        </div>
      )}
      {expected != null && expected > DAY && expected <= 365 * DAY && (
        <div class="note warn">
          <b>Long run ahead.</b> Expect roughly {formatDuration(expected)} of continuous mining on this device. Removing one character makes it 16× faster. You can pause and resume at any time, but closing the tab loses progress.
        </div>
      )}
    </div>
  );
}
