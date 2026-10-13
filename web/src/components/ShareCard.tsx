import { useEffect, useRef, useState } from 'preact/hooks';
import type { SearchResult } from '../engine/types';
import { renderShareCard, downloadCanvas, type CardStyle } from '../lib/shareCard';
import { CopyButton } from './Copy';

const UNLOCK_KEY = 'cairn.sharecard.unlock';

function storedUnlock(): string | null {
  try {
    return localStorage.getItem(UNLOCK_KEY);
  } catch {
    return null;
  }
}

/**
 * Share card: free with a small watermark; clean high-res version and alternate
 * styles after a small crypto checkout (same order system as Pro). The image
 * is rendered client-side from the address only; the private key is never
 * passed to the renderer.
 */
export function ShareCard({ result }: { result: SearchResult }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CardStyle>('dark');
  const [unlockToken, setUnlockToken] = useState<string | null>(storedUnlock());
  const [unlocked, setUnlocked] = useState(false);
  const [order, setOrder] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // check whether a stored unlock token is paid
  useEffect(() => {
    if (!unlockToken) return;
    fetch(`/api/orders/${encodeURIComponent(unlockToken)}`)
      .then((r) => r.json())
      .then((o) => {
        setOrder(o);
        setUnlocked(o.kind === 'sharecard' && o.status !== 'awaiting_payment' && o.status !== 'expired');
      })
      .catch(() => {});
  }, [unlockToken, open]);

  useEffect(() => {
    if (!open || !previewRef.current) return;
    const c = renderShareCard(result.checksummed, result.pattern, { style: unlocked ? style : 'dark', watermark: !unlocked, scale: 1 });
    c.style.width = '100%';
    c.style.height = 'auto';
    c.style.borderRadius = '6px';
    previewRef.current.replaceChildren(c);
  }, [open, style, unlocked, result.checksummed]);

  async function buy(asset: 'USDC' | 'ETH' | 'BTC') {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/orders/sharecard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payAsset: asset }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'could not create order');
      localStorage.setItem(UNLOCK_KEY, j.token);
      setUnlockToken(j.token);
      setOrder(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result.kind === 'split') return null;

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <button type="button" class="btn sm" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide share card' : 'Share card (image)'}
      </button>
      {open && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div ref={previewRef} />
          <div class="actions">
            <button type="button" class="btn sm primary" onClick={() => downloadCanvas(renderShareCard(result.checksummed, result.pattern, { style: unlocked ? style : 'dark', watermark: !unlocked, scale: unlocked ? 3 : 1 }), `0xcairn-${result.checksummed.slice(0, 8)}.png`)}>
              {unlocked ? 'Download clean 3600×1890' : 'Download free (watermarked)'}
            </button>
            {unlocked &&
              (['dark', 'light', 'amber'] as CardStyle[]).map((s) => (
                <button type="button" key={s} class={`chip ${style === s ? 'on' : ''}`} onClick={() => setStyle(s)}>
                  {s}
                </button>
              ))}
          </div>
          {!unlocked && (
            <div class="note" style={{ display: 'grid', gap: '8px' }}>
              <span>
                <b>Clean version:</b> no watermark, 3× resolution, three styles, for $3 in USDC on Base, ETH or BTC. One purchase unlocks it for every address in this browser.
              </span>
              {!order ? (
                <div class="actions">
                  <button type="button" class="btn sm" disabled={busy} onClick={() => buy('USDC')}>
                    Pay $3 in USDC
                  </button>
                  <button type="button" class="btn sm" disabled={busy} onClick={() => buy('ETH')}>
                    Pay in ETH
                  </button>
                  <button type="button" class="btn sm" disabled={busy} onClick={() => buy('BTC')}>
                    Pay in BTC
                  </button>
                  {err && <span class="field-error">{err}</span>}
                </div>
              ) : order.payment ? (
                <span style={{ fontSize: '13px' }}>
                  Send {order.payment.amount} {order.payment.asset} on {order.payment.chain} to <span class="mono">{order.payment.address}</span> <CopyButton text={order.payment.address} /> then reopen this card. <a href={order.url}>Order page</a>.
                </span>
              ) : null}
            </div>
          )}
          <p style={{ fontSize: '12px', color: 'var(--muted)' }}>The image contains only the address and your pattern. The renderer never receives the private key.</p>
        </div>
      )}
    </div>
  );
}
