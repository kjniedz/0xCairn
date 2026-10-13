import { useEffect, useState } from 'preact/hooks';
import { Header, TopStrip } from './components/Header';
import { AddressTab } from './components/AddressTab';
import { Create2Tab } from './components/Create2Tab';
import { SplitKeyTab } from './components/SplitKeyTab';
import { ResultCard } from './components/ResultCard';
import { AddressPreview } from './components/AddressPreview';
import { TrustStrip } from './components/TrustStrip';
import { Explainer } from './components/Explainer';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';
import { useSearch } from './hooks/useSearch';
import type { Pattern } from './lib/pattern';
import { DEFAULT_CHAIN } from './chains/evm';

type Tab = 'address' | 'create2' | 'split';

const TABS: Array<[Tab, string]> = [
  ['address', 'Address'],
  ['create2', 'CREATE2 contract'],
  ['split', 'Split-key'],
];

/** Pattern prefilled from the URL (SEO pages and Pro link back into the generator). */
function patternFromUrl(): Pattern {
  if (typeof location === 'undefined') return { prefix: '', suffix: '', caseSensitive: false };
  const q = new URLSearchParams(location.search);
  const cs = q.get('cs') === '1';
  const clean = (s: string | null) => (s ? DEFAULT_CHAIN.cleanInput(s) : '');
  return { prefix: clean(q.get('prefix')), suffix: clean(q.get('suffix')), caseSensitive: cs };
}

export function App() {
  const { snap, controller } = useSearch();
  const [tab, setTab] = useState<Tab>('address');
  const [pattern, setPattern] = useState<Pattern>(patternFromUrl);
  const busy = snap.status === 'running' || snap.status === 'starting' || snap.status === 'paused';

  useEffect(() => {
    const t = new URLSearchParams(location.search).get('mode');
    if (t === 'create2' || t === 'split') setTab(t);
  }, []);

  const latest = snap.results[0];
  const found = snap.status === 'found' && latest && latest.kind !== 'create2' ? latest.checksummed : snap.status === 'found' && latest ? latest.checksummed : null;

  return (
    <>
      <TopStrip />
      <div class="wrap">
        <Header />
        <main>
          <section class="hero">
            <h1>Vanity addresses for every EVM chain</h1>
            <p>Choose a prefix or suffix. 0xCairn mines a matching address and private key on every core of your machine, plus your GPU. Nothing leaves your browser.</p>
            <AddressPreview pattern={pattern} status={snap.status} sample={snap.sample} found={found} attempts={snap.attempts} />
            <TrustStrip />
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
                <button type="button" class="btn xs ghost" onClick={() => controller.clearResults()}>
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
    </>
  );
}
