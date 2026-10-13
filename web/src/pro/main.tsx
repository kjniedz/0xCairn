import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import '@fontsource-variable/montserrat';
import '../styles.css';
import { PageShell } from '../components/PageShell';
import { PatternFields } from '../components/PatternFields';
import { CopyButton } from '../components/Copy';
import { SplitDiagram } from './SplitDiagram';
import { DEFAULT_CHAIN } from '../chains/evm';
import { validatePattern, hexCount, formatBig, formatDuration, type Pattern } from '../lib/pattern';
import { quoteForPattern, tierTable, PRO } from '../lib/pricing';
import { randomScalar, privateKeyToPublicKey, bytesToHex } from '../lib/eth';
import { qrMatrix } from '../lib/qr';
import { SITE } from '../site';

type Step = 'quote' | 'keypair' | 'pay';

function patternFromUrl(): Pattern {
  const q = new URLSearchParams(location.search);
  const clean = (s: string | null) => (s ? DEFAULT_CHAIN.cleanInput(s) : '');
  return { prefix: clean(q.get('prefix')), suffix: clean(q.get('suffix')), caseSensitive: q.get('cs') === '1' };
}

function saveHalf(token: string, privHex: string, pubHex: string): void {
  localStorage.setItem(`cairn.pro.half.${token}`, JSON.stringify({ priv: privHex, pub: pubHex, savedAt: Date.now() }));
}

function Pro() {
  const [pattern, setPattern] = useState<Pattern>(patternFromUrl);
  const [step, setStep] = useState<Step>('quote');
  const [half, setHalf] = useState<{ priv: string; pub: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [asset, setAsset] = useState<'USDC' | 'ETH' | 'BTC'>('USDC');
  const [email, setEmail] = useState('');
  const [order, setOrder] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ payments: boolean; evm?: boolean; btc?: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        setHealth(h);
        if (!h.evm && h.btc) setAsset('BTC');
      })
      .catch(() => setHealth({ payments: false }));
  }, []);

  const err = hexCount(pattern) > 0 ? validatePattern(pattern) : 'Enter a prefix, a suffix, or both.';
  const quote = useMemo(() => (err ? null : quoteForPattern(pattern)), [pattern, err]);
  const tiers = useMemo(() => tierTable(), []);

  function generate() {
    const priv = randomScalar();
    setHalf({ priv: bytesToHex(priv), pub: bytesToHex(privateKeyToPublicKey(priv)) });
    setReveal(false);
  }

  function downloadHalf() {
    if (!half) return;
    const blob = new Blob([`0xCairn Pro - your private key half. Keep this. Combine it with the offset on your order page.\nprivate_half=0x${half.priv}\npublic_key=0x${half.pub}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `0xcairn-pro-half-${half.pub.slice(2, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function placeOrder() {
    if (!half) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: '0x' + half.pub, prefix: pattern.prefix, suffix: pattern.suffix, caseSensitive: pattern.caseSensitive, payAsset: asset, email: email || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'order failed');
      saveHalf(j.token, half.priv, half.pub);
      setOrder(j);
      setStep('pay');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <section class="hero" style={{ textAlign: 'left', paddingBottom: '8px' }}>
        <p class="eyebrow">Cairn Pro</p>
        <h1 style={{ margin: 0, maxWidth: '22ch' }}>Dedicated GPUs for long patterns. We still never see your key.</h1>
        <p style={{ margin: '16px 0 0', maxWidth: '620px' }}>
          Patterns beyond seven or eight characters take days in a browser. Cairn Pro mines them on rented GPUs using split-key mining: your half of the key never leaves this page, we only ever find an offset.
        </p>
      </section>

      <SplitDiagram />

      <div class="panel" style={{ marginTop: '36px' }}>
        <div class="tabs" role="tablist">
          {(['quote', 'keypair', 'pay'] as Step[]).map((s, i) => (
            <button type="button" role="tab" class="tab" key={s} aria-selected={step === s} disabled={(s === 'keypair' && !quote) || (s === 'pay' && !order)} onClick={() => setStep(s)}>
              {i + 1} · {s === 'quote' ? 'Pattern and quote' : s === 'keypair' ? 'Your key half' : 'Payment and order'}
            </button>
          ))}
        </div>

        {step === 'quote' && (
          <div class="panel-body">
            <PatternFields pattern={pattern} onChange={setPattern} rate={PRO.rigKeysPerSec} />
            {quote && (
              <>
                <div class="difficulty">
                  <div class="stat">
                    <div class="k">Difficulty</div>
                    <div class="v">
                      1 in {formatBig(quote.difficulty)}
                      <small>{hexCount(pattern)} fixed characters</small>
                    </div>
                  </div>
                  <div class="stat">
                    <div class="k">Expected time</div>
                    <div class="v">
                      {formatDuration(quote.expectedSeconds)}
                      <small>90% within {formatDuration(quote.seconds90)}</small>
                    </div>
                  </div>
                  <div class="stat">
                    <div class="k">Price</div>
                    <div class="v">
                      ${quote.usd.toFixed(2)}
                      <small>USDC on Base, ETH, or BTC</small>
                    </div>
                  </div>
                  <div class="stat">
                    <div class="k">Refund policy</div>
                    <div class="v">
                      {PRO.refundMultiple}× estimate
                      <small>full refund on request past that</small>
                    </div>
                  </div>
                </div>
                <p class="memoryless">
                  Price is based on expected work, not guaranteed time. Mining is memoryless: there is a 50% chance of a match within {formatDuration(quote.seconds50)}, 90% within {formatDuration(quote.seconds90)}, and a small chance it takes longer. If a job runs past {PRO.refundMultiple}× its estimate you can request a full refund from the order page at any time.
                </p>
                {quote.tooLarge && (
                  <div class="note danger">
                    This target is above what we sell online. <a href={SITE.teamsPath}>Contact Teams</a> for a dedicated quote.
                  </div>
                )}
                {quote.expectedSeconds < 1800 && !quote.tooLarge && (
                  <div class="note">
                    This pattern is short enough that your own machine will likely find it in under an hour. <a href={`/?prefix=${encodeURIComponent(pattern.prefix)}&suffix=${encodeURIComponent(pattern.suffix)}${pattern.caseSensitive ? '&cs=1' : ''}`}>Mine it free in the browser</a>, or continue if you would rather not wait.
                  </div>
                )}
                <div class="actions">
                  <button type="button" class="btn primary" disabled={!!err || quote.tooLarge} onClick={() => setStep('keypair')}>
                    Continue to key generation
                  </button>
                </div>
              </>
            )}
            {err && <div class="field-help">{err}</div>}
          </div>
        )}

        {step === 'keypair' && (
          <div class="panel-body">
            <div class="note">
              <b>This is the whole trick.</b> Generate a keypair here, in your browser. Only the public key is sent with your order. The private half stays in this browser (and in the file you download), and you will need it to combine the result.
            </div>
            <div class="actions">
              <button type="button" class="btn" onClick={generate}>
                {half ? 'Generate a new keypair' : 'Generate keypair locally'}
              </button>
            </div>
            {half && (
              <>
                <div class="kv">
                  <div class="k">
                    <span>Public key (sent with your order)</span>
                    <CopyButton text={'0x' + half.pub} />
                  </div>
                  <div class="v">0x{half.pub}</div>
                </div>
                <div class="kv">
                  <div class="k">
                    <span>Your private half (never sent)</span>
                    <span style={{ display: 'inline-flex', gap: '6px' }}>
                      {reveal && <CopyButton text={'0x' + half.priv} />}
                      <button type="button" class="btn xs" onClick={() => setReveal((r) => !r)}>
                        {reveal ? 'Hide' : 'Reveal'}
                      </button>
                      <button type="button" class="btn xs" onClick={downloadHalf}>
                        Download
                      </button>
                    </span>
                  </div>
                  <div class={`v secret ${reveal ? '' : 'hidden'}`} onClick={() => !reveal && setReveal(true)}>
                    0x{half.priv}
                  </div>
                  <div class="warn">Download it. If this browser's storage is cleared before the job finishes and you do not have this file, the result cannot be combined and the work is wasted.</div>
                </div>
                <hr class="divider" />
                <div class="field-row">
                  <div class="field">
                    <span class="label">Pay with</span>
                    <div class="actions">
                      <button type="button" class={`btn ${asset === 'USDC' ? 'primary' : ''}`} disabled={health != null && !health.evm} onClick={() => setAsset('USDC')}>
                        USDC on Base
                      </button>
                      <button type="button" class={`btn ${asset === 'ETH' ? 'primary' : ''}`} disabled={health != null && !health.evm} onClick={() => setAsset('ETH')}>
                        ETH on Ethereum
                      </button>
                      <button type="button" class={`btn ${asset === 'BTC' ? 'primary' : ''}`} onClick={() => setAsset('BTC')}>
                        BTC
                      </button>
                    </div>
                  </div>
                  <div class="field">
                    <label for="email">Email for a "found" notification (optional)</label>
                    <div class="input-wrap full">
                      <input id="email" type="email" placeholder="you@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
                    </div>
                    <div class="field-help">Never required. The order page works without it.</div>
                  </div>
                </div>
                {health && !health.payments && <div class="note warn">Payments are not switched on yet on this deployment.</div>}
                {health && health.payments && !health.evm && <div class="note">USDC and ETH checkout are not enabled yet on this deployment; Bitcoin is.</div>}
                {error && <div class="note danger">{error}</div>}
                <div class="actions">
                  <button type="button" class="btn primary" disabled={busy || !quote || (health != null && !health.payments)} onClick={placeOrder}>
                    {busy ? 'Creating order…' : `Create order · $${quote?.usd.toFixed(2)}`}
                  </button>
                  <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>Nothing is charged until you send the payment on the next step.</span>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'pay' && order && <Payment order={order} />}
      </div>

      <section class="section">
        <h2>Pricing by pattern length</h2>
        <p>Every extra character multiplies the expected work by 16. These are example quotes for case-insensitive patterns; the quote above is exact for yours.</p>
        <table class="tiers">
          <thead>
            <tr>
              <th>Fixed characters</th>
              <th>Expected attempts</th>
              <th>Expected time on our rigs</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.chars}>
                <td class="mono">{t.chars}</td>
                <td class="mono">{formatBig(t.quote.difficulty)}</td>
                <td>{formatDuration(t.quote.expectedSeconds)}</td>
                <td class="mono">{t.quote.tooLarge ? 'contact Teams' : `$${t.quote.usd.toFixed(2)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: '12px', fontSize: '13px' }}>
          Case-sensitive patterns double the work for each letter. Contract addresses, leading-zero targets and Uniswap v4 hook flags are handled by <a href={SITE.teamsPath} style={{ color: 'var(--accent)' }}>Cairn for Teams</a>.
        </p>
      </section>

      <section class="section">
        <h2>Privacy note</h2>
        <p>
          We store your public key, your pattern, the payment address we generated for you, the offset we find, and an email address only if you give one. Nothing else: no IP addresses, no analytics, no request logs. Orders are deleted 90 days after completion. Full details in the <a href={SITE.privacyPath} style={{ color: 'var(--accent)' }}>privacy policy</a>.
        </p>
      </section>
    </PageShell>
  );
}

function Payment({ order }: { order: Record<string, any> }) {
  const pay = order.payment;
  const uri = pay
    ? pay.asset === 'BTC'
      ? `bitcoin:${pay.address}?amount=${pay.amount}`
      : pay.asset === 'ETH'
        ? `ethereum:${pay.address}@1?value=${BigInt(Math.round(Number(pay.amount) * 1e6)) * 1000000000000n}`
        : `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=${pay.address}&uint256=${BigInt(Math.round(Number(pay.amount) * 1e6))}`
    : '';
  const m = useMemo(() => (uri ? qrMatrix(uri, 'L') : null), [uri]);
  return (
    <div class="panel-body">
      <div class="note ok">
        <b>Order created.</b> Bookmark your order page now: <a href={order.url}>{order.url}</a>. It is the only way to retrieve the result.
      </div>
      {pay ? (
        <div class="result-grid">
          <div style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
            <div class="kv">
              <div class="k">
                <span>
                  Send exactly {pay.amount} {pay.asset} on {pay.chain === 'base' ? 'Base' : pay.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum mainnet'}
                </span>
                <CopyButton text={pay.amount} label="Copy amount" />
              </div>
              <div class="v">
                {pay.amount} {pay.asset}
                {pay.rateUsd && pay.asset !== 'USDC' ? <small style={{ color: 'var(--muted)' }}> · {pay.asset} at ${Number(pay.rateUsd).toFixed(2)}, rate locked for this order</small> : null}
              </div>
            </div>
            <div class="kv">
              <div class="k">
                <span>{pay.asset === 'BTC' ? 'To this address (the amount is unique to your order)' : 'To this address (unique to your order)'}</span>
                <CopyButton text={pay.address} />
              </div>
              <div class="v">{pay.address}</div>
              <div class="warn">
                {pay.asset === 'USDC' ? 'USDC on Base only. Sending on another chain or another token cannot be detected.' : pay.asset === 'BTC' ? 'Send the exact amount shown, including the last satoshis: that is how we match your payment to this order. Detected after one confirmation.' : 'ETH on Ethereum mainnet only. Payments on L2s are not detected for ETH orders.'} The order expires if unpaid after {PRO.paymentWindowHours} hours.
              </div>
            </div>
            <p style={{ fontSize: '13.5px', color: 'var(--text-2)' }}>We check the chain every few minutes. Once the payment lands the job enters the GPU queue and your order page updates from "awaiting payment" to "queued" and then "mining". You can close this tab.</p>
            <div class="actions">
              <a class="btn primary" href={order.url}>
                Open order page
              </a>
            </div>
          </div>
          {m && (
            <div class="qr-wrap">
              <svg class="qr" viewBox={`0 0 ${m.size} ${m.size}`} shape-rendering="crispEdges" role="img" aria-label="Payment QR code">
                <path d={m.path} fill="#000" />
              </svg>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{pay.asset === 'BTC' ? 'BIP-21 payment request' : 'EIP-681 payment request'}</span>
            </div>
          )}
        </div>
      ) : (
        <div class="note">
          This order does not require payment. <a href={order.url}>Open the order page</a>.
        </div>
      )}
    </div>
  );
}

render(<Pro />, document.getElementById('app')!);
