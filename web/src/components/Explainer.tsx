import { SITE } from '../site';

export function Explainer() {
  return (
    <>
      <section class="section" id="how">
        <h2>How 0xCairn generates a custom Ethereum address</h2>
        <p>
          An Ethereum address is the last 20 bytes of keccak256(publicKey), and the public key comes from a random 256-bit private key. There is no way to pick an address directly, so a vanity address generator tries keys until one lands on your pattern. 0xCairn does that faster than other tools and does it entirely on your machine.
        </p>
        <div class="how">
          <div>
            <h3>browser only</h3>
            <p>No server ever sees a key. No analytics, no third-party scripts, and a strict Content Security Policy that blocks every network connection except the app's own files. Load it, go offline, mine.</p>
          </div>
          <div>
            <h3>all cores, plus GPU</h3>
            <p>One Web Worker per CPU core runs a Rust/WebAssembly kernel with batched secp256k1 point addition and keccak256. With WebGPU, a compute shader walks hundreds of thousands of points in parallel on top.</p>
          </div>
          <div>
            <h3>verified twice</h3>
            <p>Every match from the WASM kernel or the GPU is re-derived with the independent @noble libraries before display, and the GPU must pass a known-answer self-test on every page load.</p>
          </div>
          <div>
            <h3>256-bit seeds</h3>
            <p>Each worker starts from its own full 256-bit random scalar from crypto.getRandomValues. Never a 32-bit seed, never a timestamp: the mistake that let attackers drain Profanity wallets cannot happen here.</p>
          </div>
          <div>
            <h3>any EVM chain</h3>
            <p>Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, zkSync, Scroll, Linea, Gnosis and every other EVM network share the same address derivation. One key, one address, everywhere.</p>
          </div>
          <div>
            <h3>open source</h3>
            <p>
              The kernel, the shader, the verification layer and the build are public under the MIT licence.{' '}
              <a href={SITE.repo} rel="noopener" target="_blank" style={{ color: 'var(--accent)' }}>
                Read the code
              </a>{' '}
              before you trust it with a key.
            </p>
          </div>
        </div>
      </section>

      <section class="section" id="safety">
        <h2>Before you fund a vanity address</h2>
        <ol class="checklist">
          <li>
            <b>Disconnect first.</b> Load this page, then turn off Wi-Fi. The status in the header turns green when you are offline, and the app keeps working.
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
            <b>Never paste the private key into anything you did not generate it in.</b> Not a chat, not a form, not a "checker".
          </li>
          <li>
            <b>Mining for someone else?</b> Use split-key mode. You can never see their key, and they can verify the offset locally.
          </li>
        </ol>
      </section>
    </>
  );
}
