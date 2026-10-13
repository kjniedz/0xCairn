import { useState } from 'preact/hooks';
import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import type { Pattern } from '../lib/pattern';
import { PatternFields } from './PatternFields';
import { Presets } from './Presets';
import { EnginePanel } from './EnginePanel';
import { DifficultyPanel } from './DifficultyPanel';
import { RunControls } from './RunControls';

interface Props {
  snap: SearchSnapshot;
  controller: SearchController;
  pattern: Pattern;
  setPattern: (p: Pattern) => void;
}

export function AddressTab({ snap, controller, pattern, setPattern }: Props) {
  const [finder, setFinder] = useState(false);
  const busy = snap.status === 'running' || snap.status === 'starting' || snap.status === 'paused';
  const live = snap.status === 'running';
  const rate = live ? snap.rate : controller.estimatedRate();
  return (
    <div class="panel-body">
      <Presets rate={controller.estimatedRate()} disabled={busy} onPick={(p) => setPattern(p)} onFind={() => setFinder(true)} />
      <PatternFields pattern={pattern} onChange={setPattern} disabled={busy} rate={controller.estimatedRate()} finderOpen={finder} onFinderToggle={setFinder} />
      <DifficultyPanel pattern={pattern} rate={rate} live={live} proLink />
      <RunControls snap={snap} controller={controller} pattern={pattern} onStart={() => controller.start({ kind: 'address', pattern })} />
      <hr class="divider" />
      <EnginePanel snap={snap} controller={controller} />
      <div class="callout">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M2 6.5a8.5 8.5 0 0 1 12 0M4.5 9a5 5 0 0 1 7 0M7 11.5a1.5 1.5 0 0 1 2 0" />
          <path d="M2 2l12 12" />
        </svg>
        <span>
          <b>For a key you intend to fund, disconnect first.</b> Everything keeps working offline. Save the result as an encrypted keystore, import it into your wallet, and send a small test amount before anything else.
        </span>
      </div>
    </div>
  );
}
