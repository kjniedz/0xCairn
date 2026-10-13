import { useMemo, useState } from 'preact/hooks';
import type { SearchResult } from '../engine/types';
import { CopyButton } from './Copy';
import { qrMatrix } from '../lib/qr';
import { encryptKeystoreV3, keystoreFilename } from '../lib/keystore';
import { hexToBytes } from '../lib/eth';
import { normalizePattern, formatBig } from '../lib/pattern';
import { SITE } from '../site';
import { SaveToHistory } from './History';
import { ShareCard } from './ShareCard';

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
          {result.engine === 'local' ? 'combined locally' : `${result.engine} · ${formatBig(result.attempts)} attempts`} · verified twice
        </span>
        {onDismiss && (
          <button type="button" class="btn xs ghost" onClick={onDismiss} aria-label="Dismiss result">
            ✕
          </button>
        )}
      </div>

      <div class="result-grid">
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <div class="kv">
            <div class="k">
              <span>{result.kind === 'create2' ? 'Contract address' : 'Address'} · EIP-55 checksummed</span>
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
                <button type="button" class="btn xs" onClick={() => setRevealed((r) => !r)}>
                  {revealed ? 'Hide' : 'Reveal'}
                </button>
              </span>
            </div>
            <div class={`v secret ${revealed ? '' : 'hidden'}`} onClick={() => !revealed && setRevealed(true)} role={revealed ? undefined : 'button'} tabIndex={revealed ? -1 : 0}>
              {secretHex}
            </div>
            {isKey && <div class="warn">Anyone holding this key controls the address on every chain. Never paste it anywhere you did not generate it.</div>}
          </div>

          {isKey && (
            <div class="actions">
              <button type="button" class="btn primary" onClick={() => setShowKeystore((s) => !s)}>
                Download encrypted keystore
              </button>
              <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>V3 JSON, scrypt + AES-128-CTR. Imports into MetaMask, Rabby, geth and most wallets.</span>
            </div>
          )}
          {isKey && showKeystore && (
            <div class="inline-form">
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
              <div class="field-help" style={{ marginTop: 0 }}>
                The file is only as strong as this password. Store it in more than one place.
              </div>
              {ksError && <div class="field-error">{ksError}</div>}
            </div>
          )}

          {result.kind !== 'create2' && (
            <div class="chips" title="One private key controls the same address on every EVM-compatible network">
              {CHAINS.map((c) => (
                <span class="chip-static" key={c}>
                  {c}
                </span>
              ))}
            </div>
          )}
          {result.kind === 'create2' && (
            <p style={{ fontSize: '13px', color: 'var(--text-2)' }}>
              Deploy through the same factory with this salt and the exact init code you hashed. The contract lands on this address on any EVM chain where the factory lives at the same address.
            </p>
          )}
          {result.kind === 'split' && (
            <p style={{ fontSize: '13px', color: 'var(--text-2)' }}>
              This offset is useless on its own. Only the requester, who holds the matching private key, can combine it into the final key in step 3.
            </p>
          )}

          {(isKey || result.kind === 'create2') && (
            <div style={{ display: 'grid', gap: '10px' }}>
              {isKey && <SaveToHistory result={result} />}
              <ShareCard result={result} />
            </div>
          )}

          {isKey && (
            <div class="hw-line">
              Funding this address? Import the keystore into a hardware wallet such as{' '}
              <a href={SITE.affiliate.ledger} rel="noopener sponsored" target="_blank">
                Ledger
              </a>{' '}
              or{' '}
              <a href={SITE.affiliate.trezor} rel="noopener sponsored" target="_blank">
                Trezor
              </a>{' '}
              so the key never sits in a browser again.
            </div>
          )}
        </div>

        <div class="qr-wrap">
          <Qr text={qrSecret ? secretHex : address} label={qrSecret ? 'Private key QR code' : 'Address QR code'} />
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{qrSecret ? secretLabel : 'Address'}</span>
          {isKey && revealed && (
            <button type="button" class="btn xs" onClick={() => setQrSecret((s) => !s)}>
              {qrSecret ? 'Show address QR' : 'Show private key QR'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
