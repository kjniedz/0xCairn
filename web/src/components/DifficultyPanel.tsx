import type { Pattern } from '../lib/pattern';
import { difficulty, hexCount, letterCount, formatBig, formatDuration, formatRate, validatePattern, attemptsForProbability } from '../lib/pattern';
import { SITE } from '../site';

interface Props {
  pattern: Pattern;
  rate: number | null;
  live: boolean;
  /** Show the Cairn Pro pointer for long patterns (address mode only). */
  proLink?: boolean;
}

const HOUR = 3600;
const DAY = 86400;

export function DifficultyPanel({ pattern, rate, live, proLink }: Props) {
  if (hexCount(pattern) === 0 || validatePattern(pattern)) return null;
  const diff = difficulty(pattern);
  const n = hexCount(pattern);
  const letters = pattern.caseSensitive ? letterCount(pattern) : 0;
  const has = rate != null && rate > 0;
  const expected = has ? diff / rate : null;
  const t50 = has ? attemptsForProbability(0.5, diff) / rate : null;
  const t90 = has ? attemptsForProbability(0.9, diff) / rate : null;
  const proHref = `${SITE.proPath}?prefix=${encodeURIComponent(pattern.prefix)}&suffix=${encodeURIComponent(pattern.suffix)}${pattern.caseSensitive ? '&cs=1' : ''}`;

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div class="difficulty">
        <div class="stat">
          <div class="k">Difficulty</div>
          <div class="v">
            1 in {formatBig(diff)}
            <small>
              16<sup>{n}</sup>
              {letters > 0 ? ` × 2^${letters} checksum` : ''}
            </small>
          </div>
        </div>
        <div class="stat">
          <div class="k">50% chance within</div>
          <div class="v">
            {t50 == null ? '…' : formatDuration(t50)}
            <small>{expected == null ? 'measuring speed' : `average ${formatDuration(expected)}`}</small>
          </div>
        </div>
        <div class="stat">
          <div class="k">90% chance within</div>
          <div class="v">
            {t90 == null ? '…' : formatDuration(t90)}
            <small>about 2.3× the average</small>
          </div>
        </div>
        <div class="stat">
          <div class="k">{live ? 'Live speed' : 'Your device'}</div>
          <div class="v">
            {rate == null ? '…' : formatRate(rate)}
            <small>{live ? 'all engines, right now' : 'from a quick benchmark'}</small>
          </div>
        </div>
      </div>
      <p class="memoryless">Vanity mining has no memory. Every attempt is an independent 1-in-{formatBig(diff)} shot, so passing the average does not make a match due.</p>
      {expected != null && expected > 365 * DAY && (
        <div class="note danger">
          <b>Out of reach in a browser.</b> About {formatDuration(expected)} on this device. Every character you drop makes it 16× faster.
          {proLink && (
            <>
              {' '}
              <a href={proHref}>Cairn Pro</a> mines patterns this long on dedicated GPUs, and we still never see your key.
            </>
          )}
        </div>
      )}
      {expected != null && expected > DAY && expected <= 365 * DAY && (
        <div class="note warn">
          <b>Long run.</b> Roughly {formatDuration(expected)} of continuous mining here. You can pause and resume, but closing the tab loses progress.
          {proLink && (
            <>
              {' '}
              <a href={proHref}>Cairn Pro</a> can mine it on dedicated GPUs, and we still never see your key.
            </>
          )}
        </div>
      )}
      {proLink && expected != null && expected > HOUR && expected <= DAY && (
        <div class="note">
          This one could take a while on your machine. <a href={proHref}>Cairn Pro</a> can mine it on dedicated GPUs, and we still never see your key.
        </div>
      )}
    </div>
  );
}
