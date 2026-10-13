import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource-variable/montserrat';
import '../styles.css';
import { PageShell } from '../components/PageShell';
import { CopyButton } from '../components/Copy';
import { ResultCard } from '../components/ResultCard';
import type { SearchResult } from '../engine/types';
import { formatBig, formatDuration, formatRate, matchesPattern, type Pattern } from '../lib/pattern';
import { addScalars, hexToBytes, bytesToHex, isValidPrivateKey, privateKeyToAddress, privateKeyToPublicKey, toChecksum, strip0x } from '../lib/eth';
import { PRO } from '../lib/pricing';
import { SITE } from '../site';

type Order = Record<string, any>;

const STATUS_TEXT: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  queued: 'Queued for a GPU',
  mining: 'Mining',
  found: 'Found',
  expired: 'Expired (unpaid)',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

function loadHalf(token: string): { priv: string; pub: string } | null {
  try {
    const raw = localStorage.getItem(`cairn.pro.half.${token}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function OrderPage() {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailSaved, setEmailSaved] = useState(false);
  const [refundAddr, setRefundAddr] = useState('');
  const [refundMsg, setRefundMsg] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'not found');
      setOrder(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!token) return;
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [token]);

  if (!token) {
    return (
      <PageShell>
        <section class="hero" style={{ textAlign: 'left' }}>
          <h1>Order</h1>
          <p>Open the link from your order confirmation. It looks like {SITE.url}/order/?t=…</p>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section class="hero" style={{ textAlign: 'left', paddingBottom: '12px' }}>
        <p class="eyebrow">{order?.kind === 'create2' ? 'Teams job' : 'Cairn Pro order'}</p>
        <h1 style={{ margin: 0 }}>{order ? STATUS_TEXT[order.status] ?? order.status : error ? 'Order not found' : 'Loading…'}</h1>
        {order && (
          <p style={{ margin: '12px 0 0' }}>
            Target <span class="mono" style={{ color: 'var(--accent)' }}>0x{order.target.prefix}…{order.target.suffix}</span>
            {order.target.caseSensitive ? ' (case-sensitive)' : ''}{order.target.mask ? ' + bit mask' : ''} · 1 in {formatBig(order.quote.difficulty)} · expected {formatDuration(order.quote.expectedSeconds)}
          </p>
        )}
      </section>
      {error && <div class="note danger">{error}</div>}
      {order && (
        <div style={{ display: 'grid', gap: '26px' }}>
          <Status order={order} />
          {order.status === 'awaiting_payment' && order.payment && (
            <div class="panel">
              <div class="panel-body">
                <div class="kv">
                  <div class="k">
                    <span>
                      Send {order.payment.amount} {order.payment.asset} on {order.payment.chain === 'base' ? 'Base' : 'Ethereum mainnet'} to
                    </span>
                    <CopyButton text={order.payment.address} />
                  </div>
                  <div class="v">{order.payment.address}</div>
                  <div class="warn">
                    Unique to this order. Checked every few minutes. Expires {new Date(order.expiresAt * 1000).toLocaleString()} if unpaid.
                  </div>
                </div>
              </div>
            </div>
          )}
          {order.status === 'found' && order.result && (order.kind === 'split' ? <Combine order={order} /> : <SaltResult order={order} />)}
          {(order.status === 'queued' || order.status === 'mining') && (
            <div class="panel">
              <div class="panel-body">
                <div class="field">
                  <label for="email">Email me when it is found (optional)</label>
                  <div class="inline-form" style={{ borderTop: 0, paddingTop: 0 }}>
                    <div class="row">
                      <div class="input-wrap full">
                        <input id="email" type="email" placeholder={order.emailSet ? 'an email is on file; enter a new one to replace it' : 'you@example.com'} value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
                      </div>
                      <button
                        type="button"
                        class="btn"
                        onClick={async () => {
                          const r = await fetch(`/api/orders/${encodeURIComponent(token)}/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
                          setEmailSaved(r.ok);
                          void load();
                        }}
                      >
                        {emailSaved ? 'Saved' : 'Save'}
                      </button>
                    </div>
                  </div>
                  <div class="field-help">Stored only for this notification and removed when the order is deleted.</div>
                </div>
                {order.status === 'mining' && order.progress.overdueMultiple > PRO.refundMultiple && (
                  <div class="note warn" style={{ display: 'grid', gap: '10px' }}>
                    <span>
                      <b>This job has run past {PRO.refundMultiple}× its estimate.</b> That happens with memoryless searches, but it is not what you paid for. You can keep waiting or request a full refund now; the job keeps mining either way until you hear from us.
                    </span>
                    <div class="row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <div class="input-wrap full" style={{ flex: 1, minWidth: '240px' }}>
                        <input type="text" placeholder="Refund address (same chain you paid on)" value={refundAddr} onInput={(e) => setRefundAddr((e.target as HTMLInputElement).value)} />
                      </div>
                      <button
                        type="button"
                        class="btn"
                        onClick={async () => {
                          const r = await fetch(`/api/orders/${encodeURIComponent(token)}/refund`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: refundAddr }) });
                          const j = await r.json();
                          setRefundMsg(r.ok ? 'Refund requested. We process refunds manually within 2 business days.' : j.error);
                        }}
                      >
                        Request refund
                      </button>
                    </div>
                    {refundMsg && <span>{refundMsg}</span>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Status({ order }: { order: Order }) {
  const steps = order.payment ? ['awaiting_payment', 'queued', 'mining', 'found'] : ['queued', 'mining', 'found'];
  const idx = steps.indexOf(order.status);
  const p = order.progress;
  const prob = p.attempts > 0 ? 1 - Math.exp(-p.attempts / order.quote.difficulty) : 0;
  return (
    <div class="panel">
      <div class="panel-body">
        <div class="trust" style={{ margin: 0 }}>
          {steps.map((s, i) => (
            <span key={s} style={{ color: i <= idx ? 'var(--text)' : 'var(--muted)' }}>
              {i < idx ? '✓ ' : i === idx ? '● ' : ''}
              {STATUS_TEXT[s]}
            </span>
          ))}
        </div>
        {(order.status === 'mining' || order.status === 'found') && (
          <>
            <div class="bar">
              <div style={{ width: `${Math.max(1, Math.min(100, prob * 100))}%` }} />
            </div>
            <div class="runstats">
              <div class="stat">
                <div class="k">Attempts</div>
                <div class="v">
                  {formatBig(p.attempts)}
                  <small>of ~{formatBig(order.quote.difficulty)} expected</small>
                </div>
              </div>
              <div class="stat">
                <div class="k">Found by now</div>
                <div class="v">
                  {(prob * 100).toFixed(1)}%<small>probability, not progress</small>
                </div>
              </div>
              <div class="stat">
                <div class="k">Running</div>
                <div class="v">
                  {formatDuration(p.runningSeconds)}
                  <small>{p.overdueMultiple > 1 ? `${p.overdueMultiple.toFixed(1)}× the estimate` : 'within estimate'}</small>
                </div>
              </div>
              <div class="stat">
                <div class="k">GPU speed</div>
                <div class="v">
                  {p.rate ? formatRate(p.rate) : '·'}
                  <small>{order.status === 'found' ? 'done' : 'last heartbeat'}</small>
                </div>
              </div>
            </div>
            {order.status === 'mining' && p.overdueMultiple > 1.5 && p.overdueMultiple <= PRO.refundMultiple && (
              <p class="memoryless">This is taking longer than average. Searches like this have no memory, so the odds per attempt have not changed; roughly {Math.round(Math.exp(-p.attempts / order.quote.difficulty) * 100)}% of jobs are still running at this point.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Combine({ order }: { order: Order }) {
  const stored = loadHalf(order.token);
  const [priv, setPriv] = useState(stored?.priv ?? '');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const offset = order.result.hex as string;
  const pattern: Pattern = { prefix: order.target.prefix, suffix: order.target.suffix, caseSensitive: order.target.caseSensitive };

  function combine() {
    setErr(null);
    setResult(null);
    const pk = strip0x(priv.trim());
    if (!/^[0-9a-f]{64}$/i.test(pk) || !isValidPrivateKey(hexToBytes(pk))) return setErr('Your private half must be 32 bytes of hex.');
    const pub = bytesToHex(privateKeyToPublicKey(hexToBytes(pk)));
    if (order.publicKey && pub !== order.publicKey.toLowerCase()) return setErr('That private half does not match the public key on this order.');
    const final = addScalars(hexToBytes(pk), hexToBytes(offset));
    const address = privateKeyToAddress(final);
    const cs = toChecksum(address);
    if (!matchesPattern(address, cs, pattern)) return setErr('Combined address does not match the target. Verification failed; contact us with your order link.');
    if (order.result.address && cs.toLowerCase() !== strip0x(order.result.address).toLowerCase()) return setErr('Combined address differs from the one reported by the miner. Verification failed.');
    setResult({ id: order.token, kind: 'address', address, checksummed: cs, secret: bytesToHex(final), engine: 'local', attempts: order.progress.attempts, foundAt: Date.now(), pattern });
  }

  return (
    <div class="panel">
      <div class="panel-body">
        <div class="note ok">
          <b>Offset found.</b> Combine it with your private half below. This runs entirely in your browser and re-verifies the address with an independent implementation before showing anything.
        </div>
        <div class="kv">
          <div class="k">
            <span>Offset d (from our GPUs, useless on its own)</span>
            <CopyButton text={'0x' + offset} />
          </div>
          <div class="v">0x{offset}</div>
        </div>
        <div class="field">
          <label for="half">Your private half</label>
          <div class="input-wrap full">
            <input id="half" type="password" placeholder="0x…" value={priv} onInput={(e) => setPriv((e.target as HTMLInputElement).value)} autoComplete="off" />
          </div>
          <div class="field-help">{stored ? 'Loaded from this browser. ' : ''}If it is not here, paste it from the file you downloaded when ordering.</div>
        </div>
        <div class="actions">
          <button type="button" class="btn primary" onClick={combine} disabled={!priv}>
            Combine locally
          </button>
          {err && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{err}</span>}
        </div>
        {result && <ResultCard result={result} />}
      </div>
    </div>
  );
}

function SaltResult({ order }: { order: Order }) {
  return (
    <div class="panel">
      <div class="panel-body">
        <div class="note ok">
          <b>Salt found and verified server-side.</b> Deploy through your factory with this salt and the exact init code you hashed.
        </div>
        <div class="kv">
          <div class="k">
            <span>Salt</span>
            <CopyButton text={'0x' + order.result.hex} />
          </div>
          <div class="v">0x{order.result.hex}</div>
        </div>
        <div class="kv">
          <div class="k">
            <span>Contract address</span>
            <CopyButton text={order.result.address} />
          </div>
          <div class="v">{order.result.address}</div>
        </div>
      </div>
    </div>
  );
}

render(<OrderPage />, document.getElementById('app')!);
