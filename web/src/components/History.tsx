import { useEffect, useState } from 'preact/hooks';
import { historyEnabled, setHistoryEnabled, listEntries, unlockEntry, deleteEntry, wipeAll, saveEntry, type HistoryEntry } from '../lib/history';
import type { SearchResult } from '../engine/types';
import { ResultCard } from './ResultCard';
import { toChecksum } from '../lib/eth';

/** Opt-in toggle shown in the generator panel. */
export function HistoryOptIn({ onChange }: { onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(historyEnabled());
  return (
    <label class="toggle" title="Encrypted with a password you choose. Nothing is stored unencrypted.">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).checked;
          setHistoryEnabled(v);
          setOn(v);
          onChange?.(v);
        }}
      />
      <span class="sw" />
      <span>
        Remember my results in this browser <small>· encrypted with a password you set, so a refresh never loses a find</small>
      </span>
    </label>
  );
}

/** Save button rendered inside a ResultCard when history is enabled. */
export function SaveToHistory({ result }: { result: SearchResult }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  if (!historyEnabled()) return null;
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {!open && state !== 'saved' && (
        <button type="button" class="btn sm" onClick={() => setOpen(true)}>
          Save to your cairns (encrypted)
        </button>
      )}
      {state === 'saved' && <span style={{ fontSize: '12.5px', color: 'var(--ok)' }}>Saved to this browser, encrypted.</span>}
      {open && state !== 'saved' && (
        <div class="row" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <div class="input-wrap full" style={{ flex: 1, minWidth: '200px' }}>
            <input type="password" placeholder="History password (8+ characters)" value={pw} autoComplete="new-password" onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
          </div>
          <button
            type="button"
            class="btn sm primary"
            disabled={pw.length < 8 || state === 'busy'}
            onClick={async () => {
              setState('busy');
              try {
                await saveEntry(result.secret, result.address, result.pattern, result.kind, pw);
                setState('saved');
                setPw('');
              } catch (e) {
                setState('error');
                setMsg((e as Error).message);
              }
            }}
          >
            {state === 'busy' ? 'Encrypting…' : 'Save'}
          </button>
          {state === 'error' && <span class="field-error">{msg}</span>}
        </div>
      )}
    </div>
  );
}

/** "Your cairns" drawer: list, unlock, delete, wipe. */
export function HistoryDrawer() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [unlocked, setUnlocked] = useState<SearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const enabled = historyEnabled();

  async function refresh() {
    try {
      setEntries(await listEntries());
    } catch {
      setEntries([]);
    }
  }
  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, open]);

  if (!enabled && entries.length === 0) return null;

  return (
    <section class="section" style={{ paddingTop: '40px' }}>
      <div class="result-head">
        <h2 style={{ fontSize: '18px', marginBottom: 0 }}>Your cairns</h2>
        <div class="actions">
          <button type="button" class="btn sm" onClick={() => { setOpen((o) => !o); void refresh(); }}>
            {open ? 'Hide' : `Show ${entries.length || ''}`}
          </button>
          {open && entries.length > 0 && (
            <button
              type="button"
              class="btn sm ghost danger"
              onClick={async () => {
                if (confirm('Wipe every saved cairn and the history setting from this browser? This cannot be undone.')) {
                  await wipeAll();
                  setEntries([]);
                  setUnlocked(null);
                }
              }}
            >
              Wipe everything
            </button>
          )}
        </div>
      </div>
      {open && (
        <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
          {entries.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '13.5px' }}>Nothing saved yet. After a match, use "Save to your cairns" on the result.</p>}
          {entries.map((e) => (
            <div class="suggestion" key={e.id}>
              <div style={{ minWidth: 0 }}>
                <div class="hex" style={{ fontSize: '14px' }}>
                  0x{toChecksum(e.address)}
                </div>
                <div class="meta">
                  <span>{e.kind}</span>
                  <span>
                    pattern <span class="mono">{e.pattern.prefix}…{e.pattern.suffix}</span>
                  </span>
                  <span>{new Date(e.foundAt).toLocaleString()}</span>
                </div>
                {unlockId === e.id && (
                  <div class="row" style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                    <div class="input-wrap full" style={{ flex: 1, minWidth: '180px' }}>
                      <input type="password" placeholder="History password" value={pw} onInput={(ev) => setPw((ev.target as HTMLInputElement).value)} />
                    </div>
                    <button
                      type="button"
                      class="btn sm primary"
                      onClick={async () => {
                        setErr(null);
                        try {
                          const secret = await unlockEntry(e, pw);
                          setUnlocked({ id: e.id, kind: e.kind, address: e.address, checksummed: toChecksum(e.address), secret, engine: 'local', attempts: 0, foundAt: e.foundAt, pattern: e.pattern });
                          setPw('');
                          setUnlockId(null);
                        } catch (ex) {
                          setErr((ex as Error).message);
                        }
                      }}
                    >
                      Unlock
                    </button>
                    {err && <span class="field-error">{err}</span>}
                  </div>
                )}
              </div>
              <div class="acts">
                <button type="button" class="btn xs" onClick={() => { setUnlockId(unlockId === e.id ? null : e.id); setErr(null); }}>
                  Unlock
                </button>
                <button
                  type="button"
                  class="btn xs ghost danger"
                  onClick={async () => {
                    if (confirm('Delete this saved cairn?')) {
                      await deleteEntry(e.id);
                      void refresh();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {unlocked && <ResultCard result={unlocked} onDismiss={() => setUnlocked(null)} />}
        </div>
      )}
    </section>
  );
}
