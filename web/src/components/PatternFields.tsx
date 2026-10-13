import { useState } from 'preact/hooks';
import type { Pattern } from '../lib/pattern';
import { validatePattern, hexCount, letterCount, caseMultiplier, formatBig } from '../lib/pattern';
import { DEFAULT_CHAIN } from '../chains/evm';
import { HexspeakFinder } from './HexspeakFinder';

interface Props {
  pattern: Pattern;
  onChange: (p: Pattern) => void;
  disabled?: boolean;
  subject?: string;
  rate?: number | null;
  /** Controlled finder visibility (so presets can open it). */
  finderOpen?: boolean;
  onFinderToggle?: (open: boolean) => void;
}

export function PatternFields({ pattern, onChange, disabled, subject = 'address', rate = null, finderOpen, onFinderToggle }: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = finderOpen ?? localOpen;
  const setOpen = (v: boolean) => (onFinderToggle ? onFinderToggle(v) : setLocalOpen(v));
  const err = hexCount(pattern) > 0 ? validatePattern(pattern) : null;
  const total = hexCount(pattern);
  const letters = letterCount(pattern);
  const clean = DEFAULT_CHAIN.cleanInput;

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div class="field-row">
        <div class="field">
          <label for="prefix">
            <span>Prefix</span>
            {!disabled && (
              <button type="button" class="linkish" onClick={() => setOpen(!open)}>
                {open ? 'close finder' : 'find a word'}
              </button>
            )}
          </label>
          <div class={`input-wrap ${err && pattern.prefix ? 'invalid' : ''}`}>
            <span class="affix" aria-hidden="true">
              0x
            </span>
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
              aria-label="Address prefix after 0x"
              onInput={(e) => onChange({ ...pattern, prefix: clean((e.target as HTMLInputElement).value) })}
            />
          </div>
        </div>
        <div class="field">
          <label for="suffix">
            <span>Suffix</span>
          </label>
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
              aria-label="Address suffix"
              onInput={(e) => onChange({ ...pattern, suffix: clean((e.target as HTMLInputElement).value) })}
            />
            <span class="affix" aria-hidden="true">
              end
            </span>
          </div>
        </div>
      </div>

      {err ? (
        <div class="field-error" style={{ marginTop: '-6px' }}>
          {err}
        </div>
      ) : (
        <div class="field-help" style={{ marginTop: '-6px' }}>
          {total === 0
            ? `Hex only: 0-9 and a-f. Enter a prefix, a suffix, or both.`
            : `${total} fixed character${total === 1 ? '' : 's'} in your ${subject}. Each one multiplies the work by 16.`}
        </div>
      )}

      {open && (
        <HexspeakFinder
          pattern={pattern}
          rate={rate}
          onClose={() => setOpen(false)}
          onPick={(field, hex) => {
            onChange({ ...pattern, [field]: hex });
            setOpen(false);
          }}
        />
      )}

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
            {pattern.caseSensitive && letters === 0 && total > 0 && <small> · digits only, no extra cost</small>}
          </span>
        </label>
      </div>
    </div>
  );
}
