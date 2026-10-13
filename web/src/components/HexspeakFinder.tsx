import { useMemo, useState } from 'preact/hooks';
import { findHexspeak, dictionaryMatches, droppedExplanation } from '../lib/hexspeak';
import { DEFAULT_CHAIN } from '../chains/evm';
import { difficulty, formatBig, formatDuration } from '../lib/pattern';
import type { Pattern } from '../lib/pattern';

interface Props {
  pattern: Pattern;
  rate: number | null;
  onPick: (field: 'prefix' | 'suffix', hex: string) => void;
  onClose: () => void;
  initialQuery?: string;
}

export function HexspeakFinder({ pattern, rate, onPick, onClose, initialQuery = '' }: Props) {
  const [q, setQ] = useState(initialQuery);
  const chain = DEFAULT_CHAIN;
  const suggestions = useMemo(() => findHexspeak(q, chain), [q, chain]);
  const dict = useMemo(() => dictionaryMatches(q, 6), [q]);
  const dropped = suggestions[0]?.dropped ?? [];
  const dropNote = droppedExplanation(dropped);

  const eta = (hex: string, field: 'prefix' | 'suffix') => {
    const p: Pattern = field === 'prefix' ? { ...pattern, prefix: hex } : { ...pattern, suffix: hex };
    const d = difficulty(p);
    return { d, t: rate ? d / rate : null };
  };

  return (
    <div class="finder" role="region" aria-label="Find a word in hex">
      <div class="finder-head">
        <div>
          <h3>Find a word</h3>
          <p>Type a name or word. Only 0-9 and a-f exist in an address, so we suggest look-alike spellings.</p>
        </div>
        <button type="button" class="btn xs ghost" onClick={onClose} aria-label="Close finder">
          ✕
        </button>
      </div>
      <div class="input-wrap full">
        <input type="text" placeholder="e.g. coffee, alice, boss" value={q} autoComplete="off" spellcheck={false} onInput={(e) => setQ((e.target as HTMLInputElement).value)} autoFocus />
      </div>
      {q && suggestions.length === 0 && (
        <div class="field-error">None of those letters have a hex look-alike. Try a different word, or pick from the dictionary below.</div>
      )}
      {dropNote && <div class="field-help">{dropNote}</div>}
      {suggestions.length > 0 && (
        <div class="suggestions">
          {suggestions.map((s) => {
            const pre = eta(s.hex, 'prefix');
            return (
              <div class="suggestion" key={s.hex}>
                <div style={{ minWidth: 0 }}>
                  <div class="hex">
                    0x<b>{s.hex}</b>
                  </div>
                  <div class="meta">
                    <span>
                      <span class="readability" title={`readability ${Math.round(s.readability * 100)}%`}>
                        <i style={{ width: `${Math.round(s.readability * 100)}%` }} />
                      </span>
                    </span>
                    <span>
                      <span class="mono">{s.hex.length}</span> chars
                    </span>
                    <span>
                      1 in <span class="mono">{formatBig(pre.d)}</span>
                    </span>
                    <span>{pre.t == null ? 'ETA pending benchmark' : `about ${formatDuration(pre.t)}`}</span>
                    {s.fromDictionary && <span>in dictionary</span>}
                  </div>
                </div>
                <div class="acts">
                  <button type="button" class="btn xs" onClick={() => onPick('prefix', s.hex)}>
                    → prefix
                  </button>
                  <button type="button" class="btn xs" onClick={() => onPick('suffix', s.hex)}>
                    → suffix
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {dict.length > 0 && (
        <div>
          <div class="field-help" style={{ marginTop: 0, marginBottom: '8px' }}>{q ? 'From the dictionary' : 'Popular hexspeak'}</div>
          <div class="presets">
            {dict.map((d) => (
              <button type="button" class="chip" key={d.hex} onClick={() => setQ(d.word)} title={d.note ?? ''}>
                {d.word} <span class="mono">{d.hex}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
