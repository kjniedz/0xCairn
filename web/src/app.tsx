import { useState } from 'preact/hooks';
import { Header } from './components/Header';
import { AddressTab } from './components/AddressTab';
import { Create2Tab } from './components/Create2Tab';
import { SplitKeyTab } from './components/SplitKeyTab';
import { ResultCard } from './components/ResultCard';
import { Explainer } from './components/Explainer';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';
import { useSearch } from './hooks/useSearch';
import type { Pattern } from './lib/pattern';
import { SITE } from './site';

type Tab = 'address' | 'create2' | 'split';

const TABS: Array<[Tab, string]> = [
  ['address', 'Address'],
  ['create2', 'CREATE2 contract'],
  ['split', 'Split-key'],
];

export function App() {
  const { snap, controller } = useSearch();
  const [tab, setTab] = useState<Tab>('address');
  const [pattern, setPattern] = useState<Pattern>({ prefix: '', suffix: '', caseSensitive: false });
  const busy = snap.status === 'running' || snap.status === 'starting' || snap.status === 'paused';

  return (
    <div class="wrap">
      <Header />
      <main>
        <section class="hero">
          <h1>
            Vanity ETH address generator <span class="mono">for every EVM chain</span>
          </h1>
          <p>
            {SITE.tagline} Pick a prefix, a suffix, or both, and 0xCairn mines a matching address and private key on every core of your machine, plus your GPU. Nothing leaves your browser.
          </p>
        </section>

        <div class="panel">
          <div class="tabs" role="tablist" aria-label="Generator mode">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" class="tab" aria-selected={tab === id} disabled={busy && tab !== id} title={busy && tab !== id ? 'Stop the current search to switch modes' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'address' && <AddressTab snap={snap} controller={controller} pattern={pattern} setPattern={setPattern} />}
          {tab === 'create2' && <Create2Tab snap={snap} controller={controller} pattern={pattern} setPattern={setPattern} />}
          {tab === 'split' && <SplitKeyTab snap={snap} controller={controller} pattern={pattern} setPattern={setPattern} />}
        </div>

        {snap.results.length > 0 && (
          <div class="results">
            {snap.results.map((r) => (
              <ResultCard key={r.id} result={r} />
            ))}
            <div class="actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" class="btn sm ghost" onClick={() => controller.clearResults()}>
                Clear results
              </button>
            </div>
          </div>
        )}

        <Explainer />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
