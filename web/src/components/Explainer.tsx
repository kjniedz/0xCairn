import { SITE } from '../site';

export function Explainer() {
  return (
    <>
      <section class="section" id="how">
        <h2>How 0xCairn generates a custom Ethereum address</h2>
        <p>
          An Ethereum address is the last 20 bytes of keccak256(publicKey), and the public key is derived from a random 256-bit private key. There is no way to pick an address directly, so a vanity address generator simply tries keys until one lands on your pattern. 0xCairn does that trial-and-error faster than other tools and does it entirely on your machine.
        </p>
        <div class="grid3">
          <div class="card">
            <h3>browser-only</h3>
            <p>No server ever sees a key. There are no analytics, no third-party scripts, and a strict Content Security Policy blocks every network connection except the app's own files. Load it, go offline, mine.</p>
          </div>
          <div class="card">
            <h3>all cores + GPU</h3>
            <p>One Web Worker per CPU core runs a Rust/WebAssembly kernel with batched secp256k1 point addition and keccak256. If WebGPU is available, a compute shader walks hundreds of thousands of points in parallel on top of that.</p>
          </div>
          <div class="card">
            <h3>verified twice</h3>
            <p>Every match from the WASM kernel or the GPU is re-derived with the independent @noble libraries before display, and the GPU must pass a known-answer self-test on every page load. Wrong results are impossible to show.</p>
          </div>
          <div class="card">
            <h3>256-bit seeds</h3>
            <p>Each worker starts from its own full 256-bit random scalar from crypto.getRandomValues and increments from there. Never a 32-bit seed, never a timestamp: the mistake that let attackers drain Profanity wallets cannot happen here.</p>
          </div>
          <div class="card">
            <h3>any EVM chain</h3>
            <p>Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, zkSync, Scroll, Linea, Gnosis and every other EVM network share the same address derivation. One key, one address, everywhere.</p>
          </div>
          <div class="card">
            <h3>open source</h3>
            <p>
              The kernel, the shader, the verification layer and the build are all public under the MIT licence. <a href={SITE.repo} rel="noopener" target="_blank">Read the code</a> before you trust it with a key.
            </p>
          </div>
        </div>
      </section>

      <section class="section" id="safety">
        <h2>Safety checklist before you fund a vanity address</h2>
        <div class="card">
          <ol style={{ margin: 0, paddingLeft: '20px', color: 'var(--muted)', fontSize: '14px', display: 'grid', gap: '8px' }}>
            <li>
              <b>Disconnect first.</b> Load this page, then turn off Wi-Fi or unplug. The status pill at the top turns green when you are offline. The app keeps working.
            </li>
            <li>
              <b>Prefer the encrypted keystore download</b> over copying the raw private key. Use a long, unique password and store the file in more than one place.
            </li>
            <li>
              <b>Import into your wallet and confirm the address matches</b> what 0xCairn showed. MetaMask, Rabby, Frame and geth all accept V3 keystore files.
            </li>
            <li>
              <b>Send a small test amount first</b> and move it back out before transferring anything meaningful.
            </li>
            <li>
              <b>Never paste the private key into anything you did not generate it in.</b> Not a chat, not a form, not a "checker". A vanity address is not more valuable than the keys behind it.
            </li>
            <li>
              <b>Mining for someone else?</b> Use split-key mode. You can never see their key, and they can verify the offset locally.
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
