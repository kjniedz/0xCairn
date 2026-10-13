import { useMemo, useState } from 'preact/hooks';
import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import type { Pattern } from '../lib/pattern';
import { maskBits } from '../lib/pattern';
import { PatternFields } from './PatternFields';
import { EnginePanel } from './EnginePanel';
import { DifficultyPanel } from './DifficultyPanel';
import { RunControls } from './RunControls';
import { isAddress, isBytes32Hex, strip0x, hexToBytes, keccak256Hex } from '../lib/eth';
import { SITE } from '../site';

interface Props {
  snap: SearchSnapshot;
  controller: SearchController;
  pattern: Pattern;
  setPattern: (p: Pattern) => void;
}

/** Uniswap v4 hook permission flags: bit positions in the lowest 14 bits of the hook address. */
const V4_FLAGS: Array<[string, number]> = [
  ['beforeInitialize', 13],
  ['afterInitialize', 12],
  ['beforeAddLiquidity', 11],
  ['afterAddLiquidity', 10],
  ['beforeRemoveLiquidity', 9],
  ['afterRemoveLiquidity', 8],
  ['beforeSwap', 7],
  ['afterSwap', 6],
  ['beforeDonate', 5],
  ['afterDonate', 4],
  ['beforeSwapReturnDelta', 3],
  ['afterSwapReturnDelta', 2],
  ['afterAddLiquidityReturnDelta', 1],
  ['afterRemoveLiquidityReturnDelta', 0],
];

function cleanHex40(v: string): string {
  return strip0x(v).replace(/[^0-9a-fA-F]/g, '').slice(0, 40).toLowerCase();
}

export function Create2Tab({ snap, controller, pattern, setPattern }: Props) {
  const [deployer, setDeployer] = useState('');
  const [hashInput, setHashInput] = useState('');
  const [initCode, setInitCode] = useState('');
  const [advanced, setAdvanced] = useState(!!pattern.mask);
  const [flags, setFlags] = useState<number>(0);
  const busy = snap.status === 'running' || snap.status === 'starting' || snap.status === 'paused';
  const live = snap.status === 'running';
  const rate = live ? snap.rate : controller.estimatedRate();

  const derivedHash = useMemo(() => {
    const clean = strip0x(initCode.trim());
    if (!clean) return null;
    if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) return 'invalid';
    return keccak256Hex(hexToBytes(clean));
  }, [initCode]);

  const effectiveHash = derivedHash && derivedHash !== 'invalid' ? derivedHash : strip0x(hashInput.trim());

  let formError: string | null = null;
  if (!deployer.trim()) formError = 'Enter the deployer (factory) address.';
  else if (!isAddress(deployer.trim())) formError = 'Deployer must be a 20-byte hex address.';
  else if (derivedHash === 'invalid') formError = 'Init code must be even-length hex.';
  else if (!effectiveHash) formError = 'Enter the init code hash, or paste the init code to hash it.';
  else if (!isBytes32Hex(effectiveHash)) formError = 'Init code hash must be 32 bytes of hex.';

  function applyV4(next: number) {
    setFlags(next);
    // lowest 14 bits constrained: mask 0x3fff, value = flags
    const mask = '0'.repeat(36) + '3fff';
    const value = '0'.repeat(36) + next.toString(16).padStart(4, '0');
    setPattern({ ...pattern, mask, value });
  }

  function start() {
    controller.start({
      kind: 'create2',
      pattern,
      deployer: hexToBytes(strip0x(deployer.trim())),
      initCodeHash: hexToBytes(effectiveHash),
    });
  }

  const bits = pattern.mask ? maskBits(pattern.mask) : 0;

  return (
    <div class="panel-body">
      <div class="note">
        Mines a <b>CREATE2 salt</b> so your contract deploys to a vanity address: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]. You need the factory that calls CREATE2 and the exact init code (creation bytecode plus constructor args). Need many of these, or from a deploy script? <a href={SITE.teamsPath}>Cairn for Teams</a> has an API.
      </div>
      <div class="field-row">
        <div class="field">
          <label for="deployer">Deployer / factory address</label>
          <div class={`input-wrap full ${deployer && !isAddress(deployer.trim()) ? 'invalid' : ''}`}>
            <input id="deployer" type="text" placeholder="0x4e59b44847b379578588920cA78FbF26c0B4956C" spellcheck={false} autoComplete="off" value={deployer} disabled={busy} onInput={(e) => setDeployer((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field-help">The contract that executes CREATE2: the deterministic deployment proxy, a Safe factory, or your own.</div>
        </div>
        <div class="field">
          <label for="inithash">Init code hash</label>
          <div class={`input-wrap full ${hashInput && !isBytes32Hex(strip0x(hashInput.trim())) ? 'invalid' : ''}`}>
            <input
              id="inithash"
              type="text"
              placeholder="0x… 32 bytes"
              spellcheck={false}
              autoComplete="off"
              value={derivedHash && derivedHash !== 'invalid' ? `0x${derivedHash}` : hashInput}
              disabled={busy || (derivedHash != null && derivedHash !== 'invalid')}
              onInput={(e) => setHashInput((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field-help">{derivedHash && derivedHash !== 'invalid' ? 'Computed from the init code below.' : 'keccak256 of the init code, or paste the init code below and we hash it.'}</div>
        </div>
      </div>
      <div class="field">
        <label for="initcode">Init code (optional, hex)</label>
        <textarea id="initcode" class="text" placeholder="0x6080604052…  creation bytecode including encoded constructor arguments" spellcheck={false} value={initCode} disabled={busy} onInput={(e) => setInitCode((e.target as HTMLTextAreaElement).value)} />
      </div>

      <PatternFields pattern={pattern} onChange={setPattern} disabled={busy} subject="contract address" rate={controller.estimatedRate()} />

      <div>
        <button type="button" class="linkish" onClick={() => setAdvanced((a) => !a)} disabled={busy}>
          {advanced ? 'Hide bit-mask target' : 'Advanced: bit-mask target (Uniswap v4 hooks, exact bit patterns)'}
        </button>
      </div>
      {advanced && (
        <div class="finder" style={{ gap: '16px' }}>
          <div class="finder-head">
            <div>
              <h3>Bit-mask target</h3>
              <p>Require specific bits of the address to be set or cleared: (address AND mask) = value. Combine with a prefix or suffix if you like. Each constrained bit doubles the work.</p>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="mask">Mask (40 hex)</label>
              <div class="input-wrap full">
                <input id="mask" type="text" spellcheck={false} autoComplete="off" placeholder="0000000000000000000000000000000000003fff" value={pattern.mask ?? ''} disabled={busy} onInput={(e) => setPattern({ ...pattern, mask: cleanHex40((e.target as HTMLInputElement).value) })} />
              </div>
            </div>
            <div class="field">
              <label for="value">Value (40 hex)</label>
              <div class="input-wrap full">
                <input id="value" type="text" spellcheck={false} autoComplete="off" placeholder="0000000000000000000000000000000000000c80" value={pattern.value ?? ''} disabled={busy} onInput={(e) => setPattern({ ...pattern, value: cleanHex40((e.target as HTMLInputElement).value) })} />
              </div>
            </div>
          </div>
          <div class="field-help" style={{ marginTop: 0 }}>
            {bits > 0 ? `${bits} constrained bit${bits === 1 ? '' : 's'} = ${bits <= 20 ? Math.pow(2, bits).toLocaleString('en-US') : '2^' + bits}× the work.` : 'No bits constrained yet.'}
            {(pattern.mask || pattern.value) && (
              <>
                {' '}
                <button type="button" class="linkish" onClick={() => { setPattern({ ...pattern, mask: undefined, value: undefined }); setFlags(0); }} disabled={busy}>
                  clear
                </button>
              </>
            )}
          </div>
          <div>
            <div class="label" style={{ fontSize: '11.5px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Uniswap v4 hook permissions (sets the low 14 bits)
            </div>
            <div class="presets">
              {V4_FLAGS.map(([name, bit]) => (
                <button type="button" key={name} class={`chip ${flags & (1 << bit) ? 'on' : ''}`} disabled={busy} aria-pressed={!!(flags & (1 << bit))} onClick={() => applyV4(flags ^ (1 << bit))} title={`bit ${bit}`}>
                  <span class="mono">{name}</span>
                </button>
              ))}
            </div>
            <div class="field-help">Toggling a flag pins all 14 permission bits (unselected flags are forced to 0, as v4 requires), so the hook validates on deployment.</div>
          </div>
        </div>
      )}

      <DifficultyPanel pattern={pattern} rate={rate} live={live} />
      <RunControls snap={snap} controller={controller} pattern={pattern} onStart={start} formError={formError} />
      <hr class="divider" />
      <EnginePanel snap={snap} controller={controller} />
    </div>
  );
}
