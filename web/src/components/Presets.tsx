import { PRESETS } from '../content/hexspeak';
import { difficulty, formatDurationShort } from '../lib/pattern';
import type { Pattern } from '../lib/pattern';

interface Props {
  rate: number | null;
  disabled?: boolean;
  onPick: (p: Pattern) => void;
  onFind: () => void;
}

export function Presets({ rate, disabled, onPick, onFind }: Props) {
  return (
    <div class="presets" aria-label="Preset patterns">
      <span class="lbl">Try</span>
      {PRESETS.map((p) => {
        const pat: Pattern = { prefix: p.prefix, suffix: p.suffix, caseSensitive: !!p.caseSensitive };
        const d = difficulty(pat);
        return (
          <button type="button" class="chip" key={p.label} disabled={disabled} onClick={() => onPick(pat)} title={`1 in ${d.toLocaleString('en-US')}`}>
            <span class="mono">{p.label}</span>
            {rate ? <small>{formatDurationShort(d / rate)}</small> : null}
          </button>
        );
      })}
      <button type="button" class="chip" disabled={disabled} onClick={onFind}>
        match my name…
      </button>
    </div>
  );
}
