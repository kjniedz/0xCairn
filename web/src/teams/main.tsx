import { render } from 'preact';
import { useState } from 'preact/hooks';
import '@fontsource-variable/montserrat';
import '../styles.css';
import { PageShell } from '../components/PageShell';
import { tierTable, PRO } from '../lib/pricing';
import { formatBig, formatDuration } from '../lib/pattern';
import { SITE } from '../site';

function Teams() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const tiers = tierTable();

  async function send() {
    const r = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, company, message }) });
    const j = await r.json();
    setSent(r.ok ? 'Thanks. We reply within one business day.' : j.error);
  }

  return (
    <PageShell>
      <section class="hero" style={{ textAlign: 'left', paddingBottom: '8px' }}>
        <p class="eyebrow">Cairn for Teams</p>
        <h1 style={{ margin: 0, maxWidth: '22ch' }}>Vanity contract addresses, mined to order.</h1>
        <p style={{ margin: '16px 0 0', maxWidth: '640px' }}>CREATE2 salt mining for protocol engineers: addresses that save calldata gas, prefixes that carry your brand across every chain, and Uniswap v4 hook addresses with the exact flag bits your hooks need. Submit from a deploy script, poll for the salt, ship.</p>
      </section>

      <div class="how" style={{ marginTop: '40px' }}>
        <div>
          <h3>leading zeros</h3>
          <p>Every leading zero byte in a contract address saves gas on every call that passes it as calldata (zero bytes cost 4 gas instead of 16). Protocols routinely mine 4 to 8 leading zero bytes. Target with a prefix of zeros or a bit mask.</p>
        </div>
        <div>
          <h3>branded prefixes</h3>
          <p>Deploy the same bytecode through the same factory on every chain and the address is identical everywhere, so one mined salt gives you 0xBA5E… or 0x5AFE… across Ethereum, Base, Arbitrum and the rest.</p>
        </div>
        <div>
          <h3>v4 hook flags</h3>
          <p>Uniswap v4 reads hook permissions from the lowest 14 bits of the hook's address. We mine salts against a bit mask so those bits come out exactly as your hook requires while the rest stay free, or combine with a vanity prefix.</p>
        </div>
        <div>
          <h3>nothing secret</h3>
          <p>CREATE2 salts are public inputs, so there is no key to protect. Jobs are verified server-side by re-deriving the address from deployer, salt and init code hash before a result is released.</p>
        </div>
      </div>

      <section class="section" id="api">
        <h2>API</h2>
        <p>One endpoint to submit, one to poll. Authenticate with a Bearer API key. Jobs are priced by difficulty exactly like Pro; prepaid keys receive a USDC or ETH payment address per job, postpaid keys are invoiced monthly.</p>
        <pre class="code">{`# quote
curl "${SITE.url}/api/v1/quote?prefix=00000000" -H "Authorization: Bearer $CAIRN_API_KEY"

# submit a CREATE2 job (prefix/suffix, a bit mask, or both)
curl -X POST ${SITE.url}/api/v1/jobs \\
  -H "Authorization: Bearer $CAIRN_API_KEY" -H "content-type: application/json" \\
  -d '{
    "deployer": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    "initCodeHash": "0x…32 bytes…",
    "prefix": "0000",
    "mask":  "0000000000000000000000000000000000003fff",
    "value": "0000000000000000000000000000000000000c80"
  }'

# poll
curl ${SITE.url}/api/v1/jobs/<token> -H "Authorization: Bearer $CAIRN_API_KEY"
# -> { "status": "found", "result": { "hex": "<salt>", "address": "0x0000…" }, ... }`}</pre>
        <p style={{ marginTop: '14px' }}>
          Or use the CLI from the repository: <code class="mono">npx 0xcairn create2 --deployer 0x… --init-code-hash 0x… --prefix 0000 --wait</code>. It wraps the same two calls and prints the salt as JSON when the job completes.
        </p>
      </section>

      <section class="section">
        <h2>Pricing</h2>
        <p>Per job, by expected work. Masks count one doubling per constrained bit; a v4 hook mask of 14 bits costs the same as about 3.5 hex characters.</p>
        <table class="tiers">
          <thead>
            <tr>
              <th>Fixed hex characters</th>
              <th>Expected attempts</th>
              <th>Expected time</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.chars}>
                <td class="mono">{t.chars}</td>
                <td class="mono">{formatBig(t.quote.difficulty)}</td>
                <td>{formatDuration(t.quote.expectedSeconds)}</td>
                <td class="mono">{t.quote.tooLarge ? 'by quote' : `$${t.quote.usd.toFixed(2)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: '12px', fontSize: '13px' }}>Full refund on request for any job that runs past {PRO.refundMultiple}× its estimate. Volume, longer targets and postpaid invoicing: use the form below.</p>
      </section>

      <section class="section" id="contact">
        <h2>Get an API key</h2>
        <p>Tell us what you are deploying and roughly how many jobs. We send a key and a short onboarding note by email. No sales calls unless you ask.</p>
        <div class="panel" style={{ marginTop: '12px' }}>
          <div class="panel-body">
            <div class="field-row">
              <div class="field">
                <label for="email">Work email</label>
                <div class="input-wrap full">
                  <input id="email" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
                </div>
              </div>
              <div class="field">
                <label for="company">Protocol or company</label>
                <div class="input-wrap full">
                  <input id="company" type="text" value={company} onInput={(e) => setCompany((e.target as HTMLInputElement).value)} />
                </div>
              </div>
            </div>
            <div class="field">
              <label for="message">What do you need?</label>
              <textarea id="message" class="text" value={message} onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)} placeholder="e.g. 6 leading zero bytes for a router on 5 chains, deploy in two weeks" />
            </div>
            <div class="actions">
              <button type="button" class="btn primary" onClick={send} disabled={!email || message.length < 5}>
                Send
              </button>
              {sent && <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>{sent}</span>}
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

render(<Teams />, document.getElementById('app')!);
