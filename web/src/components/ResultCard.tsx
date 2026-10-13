import { useMemo, useState } from 'preact/hooks';
import type { SearchResult } from '../engine/types';
import { CopyButton } from './Copy';
import { qrMatrix } from '../lib/qr';
import { encryptKeystoreV3, keystoreFilename } from '../lib/keystore';
import { hexToBytes } from '../lib/eth';
import { normalizePattern, formatBig } from '../lib/pattern';

const CHAINS = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'zkSync', 'Scroll', 'Linea', 'Gnosis', '+ every EVM chain'];

function Qr({ text, label }: { text: string; label: string }) {
  const m = useMemo(() => qrMatrix(text), [text]);
  return (
    <svg class="qr" viewBox={`0 0 ${m.size} ${m.size}`} shape-rendering="crispEdges" role="img" aria-label={label}>
      <path d={m.path} fill="#000" />
    </svg>
  );
}

function Highlighted({ checksummed, result }: { checksummed: string; result: SearchResult }) {
  const p = normalizePattern(result.pattern);
  const pre = checksummed.slice(0, p.prefix.length);
  const mid = checksummed.slice(p.prefix.length, 40 - p.suffix.length);
  const suf = checksummed.slice(40 - p.suffix.length);
  return (
    <>
      0x<mark>{pre}</mark>
      {mid}
      <mark>{suf}</mark>
    </>
  );
}

export function ResultCard({ result, onDismiss }: { result: SearchResult; onDismiss?: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [qrSecret, setQrSecret] = useState(false);
  const [showKeystore, setShowKeystore] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [ksError, setKsError] = useState<string | null>(null);

  const address = `0x${result.checksummed}`;
  const secretHex = `0x${result.secret}`;
  const secretLabel = result.kind === 'address' ? 'Private key' : result.kind === 'split' ? 'Offset (send this back to the requester)' : 'Salt';
  const isKey = result.kind === 'address';

  async function download() {
    setKsError(null);
    if (pw.length < 8) return setKsError('Use at least 8 characters.');
    if (pw !== pw2) return setKsError('Passwords do not match.');
    setBusy(0);
    try {
      const json = await encryptKeystoreV3(hexToBytes(result.secret), pw, result.address, { onProgress: (f) => setBusy(f) });
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = keystoreFilename(result.address) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setShowKeystore(false);
      setPw('');
      setPw2('');
    } catch (e) {
      setKsError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article class="result" aria-live="polite">
      <div class="result-head">
        <h3>{result.kind === 'create2' ? 'Contract address found' : result.kind === 'split' ? 'Offset found' : 'Address found'}</h3>
        <span class="meta">
          {result.engine} · {formatBig(result.attempts)} attempts · verified ✓
        </span>
        {onDismiss && (
          <button type="button" class="btn sm ghost" onClick={onDismiss} aria-label="Dismiss result">
            ✕
          </button>
        )}
      </div>

      <div class="result-grid">
        <div style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
          <div class="kv">
            <div class="k">
              <span>{result.kind === 'create2' ? 'Contract address (checksummed)' : 'Address (checksummed)'}</span>
              <CopyButton text={address} />
            </div>
            <div class="v">
              <Highlighted checksummed={result.checksummed} result={result} />
            </div>
          </div>

          <div class="kv">
            <div class="k">
              <span>{secretLabel}</span>
              <span style={{ display: 'inline-flex', gap: '6px' }}>
                {revealed && <CopyButton text={secretHex} />}
                <button type="button" class="btn sm" onClick={() => setRevealed((r) => !r)}>
                  {revealed ? 'Hide' : 'Reveal'}
                </button>
              </span>
            </div>
            <div class={`v secret ${revealed ? '' : 'hidden'}`} onClick={() => !revealed && setRevealed(true)} role={revealed ? undefined : 'button'} tabIndex={revealed ? -1 : 0}>
              {secretHex}
            </div>
          </div>

          {result.kind !== 'create2' && (
            <div class="chips" title="One private key controls the same address on every EVM-compatible network">
              {CHAINS.map((c) => (
                <span class="chip" key={c}>
                  {c}
                </span>
              ))}
            </div>
          )}
          {result.kind === 'create2' && (
            <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Deploy through the same factory with this salt and the exact init code you hashed, and the contract will live at this address on any EVM chain where that factory exists at the same address.
            </p>
          )}
          {result.kind === 'split' && (
            <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
              This offset is useless on its own. Only the requester, who holds the matching private key, can combine it into the final key in step 3.
            </p>
          )}

          {isKey && (
            <div class="actions">
              <button type="button" class="btn" onClick={() => setShowKeystore((s) => !s)}>
                Download encrypted keystore (V3 JSON)
              </button>
            </div>
          )}
          {isKey && showKeystore && (
            <div class="inline-form">
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                Encrypts the private key with scrypt + AES-128-CTR in the standard Web3 keystore format that geth, MetaMask and most wallets import. The file is only as strong as this password.
              </div>
              <div class="row">
                <div class="input-wrap full">
                  <input type="password" placeholder="Password (8+ characters)" value={pw} autoComplete="new-password" onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
                </div>
                <div class="input-wrap full">
                  <input type="password" placeholder="Confirm password" value={pw2} autoComplete="new-password" onInput={(e) => setPw2((e.target as HTMLInputElement).value)} />
                </div>
                <button type="button" class="btn primary" disabled={busy != null} onClick={download}>
                  {busy == null ? 'Encrypt + download' : `Encrypting ${Math.round(busy * 100)}%`}
                </button>
              </div>
              {ksError && <div class="field-error">{ksError}</div>}
            </div>
          )}
        </div>

        <div class="qr-wrap">
          <Qr text={qrSecret ? secretHex : address} label={qrSecret ? 'Private key QR code' : 'Address QR code'} />
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{qrSecret ? secretLabel : 'Address'}</span>
          {isKey && revealed && (
            <button type="button" class="btn sm" onClick={() => setQrSecret((s) => !s)}>
              {qrSecret ? 'Show address QR' : 'Show private key QR'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
