import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import type { Pattern } from '../lib/pattern';
import { difficulty, probability, formatBig, formatRate, formatDuration, validatePattern } from '../lib/pattern';
import { useTicker } from '../hooks/useSearch';

interface Props {
  snap: SearchSnapshot;
  controller: SearchController;
  pattern: Pattern;
  onStart: () => void;
  formError?: string | null;
}

export function RunControls({ snap, controller, pattern, onStart, formError }: Props) {
  const { status } = snap;
  const running = status === 'running';
  useTicker(running, 500);
  const patternError = validatePattern(pattern);
  const ready = snap.engines.cpu.ready && !controller.isBenching;
  const canStart = !patternError && !formError && ready && (status === 'idle' || status === 'error');
  const diff = patternError ? 0 : difficulty(pattern);
  const p = snap.attempts > 0 && diff > 0 ? probability(snap.attempts, diff) : 0;
  const elapsed = snap.elapsedMs / 1000;
  const remaining50 = snap.rate > 0 && diff > 0 ? Math.max(0, (diff * Math.LN2 - snap.attempts) / snap.rate) : null;
  const active = running || status === 'paused' || status === 'found' || status === 'starting';

  return (
    <div class="progress">
      <div class="actions">
        {(status === 'idle' || status === 'error') && (
          <button type="button" class="btn primary" disabled={!canStart} onClick={onStart} title={patternError ?? formError ?? ''}>
            {!snap.engines.cpu.ready ? 'Loading…' : controller.isBenching ? 'Benchmarking…' : 'Start mining'}
          </button>
        )}
        {status === 'starting' && (
          <button type="button" class="btn primary" disabled>
            Starting…
          </button>
        )}
        {running && (
          <>
            <button type="button" class="btn" onClick={() => controller.stop()}>
              Stop
            </button>
            <button type="button" class="btn ghost" onClick={() => controller.pause()}>
              Pause
            </button>
          </>
        )}
        {status === 'paused' && (
          <>
            <button type="button" class="btn primary" onClick={() => controller.resume()}>
              Resume
            </button>
            <button type="button" class="btn ghost" onClick={() => controller.stop()}>
              Stop
            </button>
          </>
        )}
        {status === 'found' && (
          <>
            <button type="button" class="btn" onClick={() => controller.resume()}>
              Keep searching
            </button>
            <button type="button" class="btn ghost" onClick={() => controller.stop()}>
              New search
            </button>
          </>
        )}
        {(status === 'idle' || status === 'error') && formError && <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{formError}</span>}
      </div>

      {snap.error && <div class="note danger">{snap.error}</div>}
      {snap.verificationFailures > 0 && (
        <div class="note danger">
          {snap.verificationFailures} candidate{snap.verificationFailures === 1 ? '' : 's'} failed independent verification and {snap.verificationFailures === 1 ? 'was' : 'were'} discarded.
          {snap.engines.gpu.error ? ` ${snap.engines.gpu.error}` : ''}
        </div>
      )}

      {active && (
        <>
          <div class={`bar ${status === 'starting' ? 'indeterminate' : ''}`} role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Probability a match has been found by now">
            <div style={{ width: `${Math.max(1, Math.min(100, p * 100))}%` }} />
          </div>
          <div class="runstats">
            <div class="stat">
              <div class="k">Attempts</div>
              <div class="v">
                {formatBig(snap.attempts)}
                <small>of ~{formatBig(diff)} expected</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">Found by now</div>
              <div class="v">
                {(p * 100).toFixed(p > 0.99 ? 2 : 1)}%
                <small>probability, not progress</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">Elapsed</div>
              <div class="v">
                {formatDuration(elapsed)}
                <small>{running && remaining50 != null && remaining50 > 0 ? `50% point in ${formatDuration(remaining50)}` : status === 'paused' ? 'paused' : status === 'found' ? 'done' : ' '}</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">Speed</div>
              <div class="v">
                {running ? formatRate(snap.rate) : '—'.replace('—', '·')}
                <small>{running ? 'all engines' : 'idle'}</small>
              </div>
            </div>
          </div>
          <div class="status-line">
            <span>
              {running && <span class="pulse" />}
              {status === 'starting' ? 'Seeding engines…' : running ? 'Mining' : status === 'paused' ? 'Paused' : 'Match found'}
            </span>
            <span>Running longer never makes a match due; the odds per attempt stay the same.</span>
          </div>
        </>
      )}
    </div>
  );
}
