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
  /** Extra validation error from the mode-specific form (CREATE2 inputs, public key, ...). */
  formError?: string | null;
}

export function RunControls({ snap, controller, pattern, onStart, formError }: Props) {
  const { status } = snap;
  const running = status === 'running';
  useTicker(running, 500);
  const patternError = validatePattern(pattern);
  const canStart = !patternError && !formError && snap.engines.cpu.ready && (status === 'idle' || status === 'error' || status === 'found' || status === 'paused');
  const diff = patternError ? 0 : difficulty(pattern);
  const p = snap.attempts > 0 && diff > 0 ? probability(snap.attempts, diff) : 0;
  const elapsed = snap.elapsedMs / 1000;
  const remaining50 = snap.rate > 0 && diff > 0 ? Math.max(0, (diff * Math.LN2 - snap.attempts) / snap.rate) : null;

  return (
    <div class="progress">
      <div class="actions">
        {(status === 'idle' || status === 'error') && (
          <button type="button" class="btn primary" disabled={!canStart} onClick={onStart} title={patternError ?? formError ?? ''}>
            {snap.engines.cpu.ready ? 'Start mining' : 'Loading…'}
          </button>
        )}
        {status === 'starting' && (
          <button type="button" class="btn primary" disabled>
            Starting…
          </button>
        )}
        {running && (
          <>
            <button type="button" class="btn" onClick={() => controller.pause()}>
              Pause
            </button>
            <button type="button" class="btn ghost danger" onClick={() => controller.stop()}>
              Stop
            </button>
          </>
        )}
        {status === 'paused' && (
          <>
            <button type="button" class="btn primary" onClick={() => controller.resume()}>
              Resume
            </button>
            <button type="button" class="btn ghost danger" onClick={() => controller.stop()}>
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
        {(status === 'idle' || status === 'error') && (patternError || formError) && (
          <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{formError ?? patternError}</span>
        )}
      </div>

      {snap.error && <div class="note danger">{snap.error}</div>}
      {snap.verificationFailures > 0 && (
        <div class="note danger">
          {snap.verificationFailures} candidate{snap.verificationFailures === 1 ? '' : 's'} failed independent verification and {snap.verificationFailures === 1 ? 'was' : 'were'} discarded.
          {snap.engines.gpu.error ? ` ${snap.engines.gpu.error}` : ''}
        </div>
      )}

      {(running || status === 'paused' || status === 'found' || status === 'starting') && (
        <>
          <div class={`bar ${status === 'starting' ? 'indeterminate' : ''}`} role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.max(1, Math.min(100, p * 100))}%` }} />
          </div>
          <div class="status-line">
            <span>
              {running && <span class="pulse" />}
              {status === 'starting' ? 'Seeding engines…' : running ? 'Mining' : status === 'paused' ? 'Paused' : 'Match found'}
              {' · '}
              <span class="mono">{formatBig(snap.attempts)}</span> attempts
              {running && (
                <>
                  {' · '}
                  <span class="mono">{formatRate(snap.rate)}</span>
                </>
              )}
            </span>
            <span>
              <span class="mono">{(p * 100).toFixed(p > 0.99 ? 2 : 1)}%</span> chance of a match by now · <span class="mono">{formatDuration(elapsed)}</span> elapsed
              {running && remaining50 != null && remaining50 > 0 && (
                <>
                  {' · '}50% in <span class="mono">{formatDuration(remaining50)}</span>
                </>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
