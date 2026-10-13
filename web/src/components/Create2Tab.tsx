import { useMemo, useState } from 'preact/hooks';
import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import type { Pattern } from '../lib/pattern';
import { PatternFields } from './PatternFields';
import { EnginePanel } from './EnginePanel';
import { DifficultyPanel } from './DifficultyPanel';
import { RunControls } from './RunControls';
import { isAddress, isBytes32Hex, strip0x, hexToBytes, keccak256Hex } from '../lib/eth';

interface Props {
  snap: SearchSnapshot;
  controller: SearchController;
  pattern: Pattern;
  setPattern: (p: Pattern) => void;
}

export function Create2Tab({ snap, controller, pattern, setPattern }: Props) {
  const [deployer, setDeployer] = useState('');
  const [hashInput, setHashInput] = useState('');
  const [initCode, setInitCode] = useState('');
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

  function start() {
    controller.start({
      kind: 'create2',
      pattern,
      deployer: hexToBytes(strip0x(deployer.trim())),
      initCodeHash: hexToBytes(effectiveHash),
    });
  }

  return (
    <div class="panel-body">
      <div class="note">
        Mines a <b>CREATE2 salt</b> so your contract deploys to a vanity address. The address is keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:], so you need the factory that will call CREATE2 and the exact init code (creation bytecode plus constructor args).
      </div>
      <div class="field-row">
        <div class="field">
          <label for="deployer">Deployer / factory address</label>
          <div class={`input-wrap full ${deployer && !isAddress(deployer.trim()) ? 'invalid' : ''}`}>
            <input id="deployer" type="text" placeholder="0x4e59b44847b379578588920cA78FbF26c0B4956C" spellcheck={false} autoComplete="off" value={deployer} disabled={busy} onInput={(e) => setDeployer((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field-help">The contract that executes CREATE2 (e.g. the deterministic deployment proxy, Safe factory, or your own factory).</div>
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
          <div class="field-help">{derivedHash && derivedHash !== 'invalid' ? 'Computed from the init code below.' : 'keccak256 of the init code. Or paste the init code below and we hash it.'}</div>
        </div>
      </div>
      <div class="field">
        <label for="initcode">Init code (optional, hex)</label>
        <textarea id="initcode" class="text" placeholder="0x6080604052…  creation bytecode including encoded constructor arguments" spellcheck={false} value={initCode} disabled={busy} onInput={(e) => setInitCode((e.target as HTMLTextAreaElement).value)} />
      </div>

      <PatternFields pattern={pattern} onChange={setPattern} disabled={busy} subject="contract address" rate={controller.estimatedRate()} />
      <DifficultyPanel pattern={pattern} rate={rate} live={live} />
      <RunControls snap={snap} controller={controller} pattern={pattern} onStart={start} formError={formError} />
      <hr class="divider" />
      <EnginePanel snap={snap} controller={controller} />
    </div>
  );
}
