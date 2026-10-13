import type { Pattern } from '../lib/pattern';
import { validatePattern, hexCount, letterCount, caseMultiplier, formatBig } from '../lib/pattern';

interface Props {
  pattern: Pattern;
  onChange: (p: Pattern) => void;
  disabled?: boolean;
  /** Label for the thing being matched, e.g. "address" or "contract address". */
  subject?: string;
}

function cleanHex(v: string): string {
  return v.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/g, '').slice(0, 40);
}

export function PatternFields({ pattern, onChange, disabled, subject = 'address' }: Props) {
  const err = hexCount(pattern) > 0 ? validatePattern(pattern) : null;
  const total = hexCount(pattern);
  const middle = Math.max(0, 40 - total);
  const letters = letterCount(pattern);
  const shownPrefix = pattern.caseSensitive ? pattern.prefix : pattern.prefix.toLowerCase();
  const shownSuffix = pattern.caseSensitive ? pattern.suffix : pattern.suffix.toLowerCase();

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div class="field-row">
        <div class="field">
          <label for="prefix">Prefix</label>
          <div class={`input-wrap ${err && pattern.prefix ? 'invalid' : ''}`}>
            <span class="affix">0x</span>
            <input
              id="prefix"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              placeholder="c0ffee"
              value={pattern.prefix}
              disabled={disabled}
              maxLength={40}
              onInput={(e) => onChange({ ...pattern, prefix: cleanHex((e.target as HTMLInputElement).value) })}
            />
          </div>
          <div class="field-help">Hex only: 0-9 and a-f.</div>
        </div>
        <div class="field">
          <label for="suffix">Suffix</label>
          <div class={`input-wrap suffix ${err && pattern.suffix ? 'invalid' : ''}`}>
            <input
              id="suffix"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              placeholder="dead"
              value={pattern.suffix}
              disabled={disabled}
              maxLength={40}
              onInput={(e) => onChange({ ...pattern, suffix: cleanHex((e.target as HTMLInputElement).value) })}
            />
            <span class="affix">end</span>
          </div>
          <div class="field-help">Optional. Prefix, suffix, or both.</div>
        </div>
      </div>

      <div class="preview" aria-live="polite">
        0x<b>{shownPrefix}</b>
        {'·'.repeat(Math.min(middle, 40))}
        <b>{shownSuffix}</b>
        {total > 0 && (
          <span>
            {' '}
            · {total} fixed character{total === 1 ? '' : 's'} in your {subject}
          </span>
        )}
      </div>
      {err && <div class="field-error">{err}</div>}

      <div class="options">
        <label class="toggle">
          <input
            type="checkbox"
            checked={pattern.caseSensitive}
            disabled={disabled}
            onChange={(e) => onChange({ ...pattern, caseSensitive: (e.target as HTMLInputElement).checked })}
          />
          <span class="sw" />
          <span>
            Case-sensitive (EIP-55 checksum)
            {pattern.caseSensitive && letters > 0 && (
              <small>
                {' '}
                · {letters} letter{letters === 1 ? '' : 's'} = {formatBig(caseMultiplier(pattern))}× harder
              </small>
            )}
            {pattern.caseSensitive && letters === 0 && total > 0 && <small> · no letters in pattern, no extra cost</small>}
          </span>
        </label>
      </div>
    </div>
  );
}
