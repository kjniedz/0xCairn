import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import type { Pattern } from '../lib/pattern';
import { PatternFields } from './PatternFields';
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
  const busy = snap.status === 'running' || snap.status === 'starting' || snap.status === 'paused';
  const live = snap.status === 'running';
  const rate = live ? snap.rate : controller.estimatedRate();
  return (
    <div class="panel-body">
      <PatternFields pattern={pattern} onChange={setPattern} disabled={busy} />
      <DifficultyPanel pattern={pattern} rate={rate} live={live} />
      <EnginePanel snap={snap} controller={controller} />
      <RunControls snap={snap} controller={controller} pattern={pattern} onStart={() => controller.start({ kind: 'address', pattern })} />
      <p style={{ fontSize: '12.5px', color: 'var(--faint)' }}>
        Tip: for a key you intend to fund, disconnect from the internet before pressing Start. Everything keeps working offline. Save the key as an encrypted keystore, import it into your wallet, and send a small test amount first.
      </p>
    </div>
  );
}
