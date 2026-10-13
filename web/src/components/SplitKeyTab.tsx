import { useState } from 'preact/hooks';
import type { SearchSnapshot, SearchResult } from '../engine/types';
import type { SearchController } from '../engine/search';
import type { Pattern } from '../lib/pattern';
import { PatternFields } from './PatternFields';
import { EnginePanel } from './EnginePanel';
import { DifficultyPanel } from './DifficultyPanel';
import { RunControls } from './RunControls';
import { CopyButton } from './Copy';
import { ResultCard } from './ResultCard';
import {
  randomScalar,
  privateKeyToPublicKey,
  bytesToHex,
  hexToBytes,
  strip0x,
  isValidPublicKey,
  isValidPrivateKey,
  addScalars,
  privateKeyToAddress,
  toChecksum,
  pubToAffine,
} from '../lib/eth';
import { secp256k1 } from '@noble/curves/secp256k1.js';

interface Props {
  snap: SearchSnapshot;
  controller: SearchController;
  pattern: Pattern;
  setPattern: (p: Pattern) => void;
}

function parsePub(s: string): Uint8Array | null {
  const clean = strip0x(s.trim());
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  if (clean.length !== 130 && clean.length !== 66) return null;
  const b = hexToBytes(clean);
  if (!isValidPublicKey(b)) return null;
  // normalise to uncompressed
  return secp256k1.Point.fromBytes(b).toBytes(false);
}

export function SplitKeyTab({ snap, controller, pattern, setPattern }: Props) {
  const busy = snap.status === 'running' || snap.status === 'starting' || snap.status === 'paused';
  const live = snap.status === 'running';
  const rate = live ? snap.rate : controller.estimatedRate();

  // step 1
  const [partial, setPartial] = useState<{ priv: string; pub: string } | null>(null);
  const [revealPartial, setRevealPartial] = useState(false);
  // step 2
  const [pubInput, setPubInput] = useState('');
  const pub = pubInput ? parsePub(pubInput) : null;
  const formError = !pubInput.trim() ? "Paste the requester's public key." : !pub ? 'That is not a valid secp256k1 public key (0x04 + 128 hex, or 0x02/0x03 + 64 hex).' : null;
  // step 3
  const [privInput, setPrivInput] = useState('');
  const [offsetInput, setOffsetInput] = useState('');
  const [combined, setCombined] = useState<SearchResult | null>(null);
  const [combineError, setCombineError] = useState<string | null>(null);

  function generate() {
    const priv = randomScalar();
    setPartial({ priv: bytesToHex(priv), pub: bytesToHex(privateKeyToPublicKey(priv)) });
    setRevealPartial(false);
  }

  function combine() {
    setCombineError(null);
    setCombined(null);
    const pk = strip0x(privInput.trim());
    const off = strip0x(offsetInput.trim());
    if (!/^[0-9a-fA-F]{64}$/.test(pk) || !isValidPrivateKey(hexToBytes(pk))) return setCombineError('Your private key must be 32 bytes of hex.');
    if (!/^[0-9a-fA-F]{64}$/.test(off)) return setCombineError('The offset must be 32 bytes of hex.');
    const final = addScalars(hexToBytes(pk), hexToBytes(off));
    if (!isValidPrivateKey(final)) return setCombineError('Combined key is invalid (astronomically unlikely); ask the miner for another offset.');
    const address = privateKeyToAddress(final);
    setCombined({
      id: `combined-${Date.now()}`,
      kind: 'address',
      address,
      checksummed: toChecksum(address),
      secret: bytesToHex(final),
      engine: 'local',
      attempts: 0,
      foundAt: Date.now(),
      pattern,
    });
  }

  return (
    <div class="panel-body">
      <div class="note">
        <b>Split-key mining</b> lets a stranger with a GPU farm mine your vanity address without ever seeing your private key. You share a public key, they return an offset, you add it locally. Only you ever hold the final key.
      </div>

      <div class="steps">
        <section class="step">
          <h3>
            <span class="n">1 · requester</span> Generate a keypair and share the public key
          </h3>
          <p>Generated locally with crypto.getRandomValues. Keep the private part somewhere safe; you will need it in step 3. Share only the public key.</p>
          <div class="actions">
            <button type="button" class="btn" onClick={generate}>
              {partial ? 'Generate a new keypair' : 'Generate keypair'}
            </button>
          </div>
          {partial && (
            <>
              <div class="kv">
                <div class="k">
                  <span>Public key to share (uncompressed)</span>
                  <CopyButton text={`0x${partial.pub}`} />
                </div>
                <div class="v">0x{partial.pub}</div>
              </div>
              <div class="kv">
                <div class="k">
                  <span>Your private key (keep secret)</span>
                  <span style={{ display: 'inline-flex', gap: '6px' }}>
                    {revealPartial && <CopyButton text={`0x${partial.priv}`} />}
                    <button type="button" class="btn sm" onClick={() => setRevealPartial((r) => !r)}>
                      {revealPartial ? 'Hide' : 'Reveal'}
                    </button>
                  </span>
                </div>
                <div class={`v secret ${revealPartial ? '' : 'hidden'}`} onClick={() => !revealPartial && setRevealPartial(true)}>
                  0x{partial.priv}
                </div>
              </div>
            </>
          )}
        </section>

        <section class="step">
          <h3>
            <span class="n">2 · miner</span> Mine an offset for someone's public key
          </h3>
          <p>Paste the requester's public key and their desired pattern. The result is an offset, not a key: it is harmless to transmit.</p>
          <div class="field">
            <label for="pubkey">Requester's public key</label>
            <div class={`input-wrap full ${pubInput && !pub ? 'invalid' : ''}`}>
              <input id="pubkey" type="text" placeholder="0x04…" spellcheck={false} autoComplete="off" value={pubInput} disabled={busy} onInput={(e) => setPubInput((e.target as HTMLInputElement).value)} />
            </div>
            {pub && <div class="field-help">Point x = 0x{pubToAffine(pub).x.toString(16).padStart(64, '0').slice(0, 16)}… ✓ on curve</div>}
          </div>
          <PatternFields pattern={pattern} onChange={setPattern} disabled={busy} rate={controller.estimatedRate()} />
          <DifficultyPanel pattern={pattern} rate={rate} live={live} />
          <RunControls snap={snap} controller={controller} pattern={pattern} formError={formError} onStart={() => pub && controller.start({ kind: 'address', pattern, base: pub })} />
          <hr class="divider" />
          <EnginePanel snap={snap} controller={controller} />
        </section>

        <section class="step">
          <h3>
            <span class="n">3 · requester</span> Combine your private key with the offset
          </h3>
          <p>final = (yourPrivateKey + offset) mod n. Done locally; the address below must show your pattern. Then save it as a keystore.</p>
          <div class="field-row">
            <div class="field">
              <label for="mypriv">Your private key from step 1</label>
              <div class="input-wrap full">
                <input id="mypriv" type="password" placeholder="0x…" spellcheck={false} autoComplete="off" value={privInput} onInput={(e) => setPrivInput((e.target as HTMLInputElement).value)} />
              </div>
            </div>
            <div class="field">
              <label for="offset">Offset from the miner</label>
              <div class="input-wrap full">
                <input id="offset" type="text" placeholder="0x…" spellcheck={false} autoComplete="off" value={offsetInput} onInput={(e) => setOffsetInput((e.target as HTMLInputElement).value)} />
              </div>
            </div>
          </div>
          <div class="actions">
            <button type="button" class="btn primary" onClick={combine} disabled={!privInput || !offsetInput}>
              Combine
            </button>
            {combineError && <span style={{ fontSize: '13px', color: 'var(--danger)' }}>{combineError}</span>}
          </div>
          {combined && <ResultCard result={combined} onDismiss={() => setCombined(null)} />}
        </section>
      </div>
    </div>
  );
}
