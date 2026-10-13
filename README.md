# 0xCairn

**Carve your address. Any EVM chain.**

0xCairn is a vanity address generator for Ethereum and every EVM-compatible chain. Enter a prefix and/or suffix, get back a matching address and its private key. It is built to be faster, cleaner and more trustworthy than the existing tools, and trust is the product: **private keys never leave your browser.**

Live: https://0xcairn.kyleniedz99.workers.dev (until a domain is chosen)

## Trust model

- **Client-side only.** All generation happens in the browser. There is no backend for generation, no analytics, no third-party scripts. The page is served with a strict Content Security Policy (`default-src 'none'`, same-origin only, `wasm-unsafe-eval` for the kernel) both as a response header (`web/public/_headers`) and as a `<meta>` tag injected at build time.
- **Works offline.** A hand-written service worker (`web/src/sw.js`) precaches every build artefact. The UI shows an online/offline pill and encourages disconnecting before generating a key you intend to use.
- **256-bit seeds.** Every CPU worker and every GPU batch starts from its own full 256-bit scalar from `crypto.getRandomValues`. Keys are walked forward from the seed by adding `G`, which is a pure speed optimisation. The Profanity exploit came from a 32-bit seed; that mistake is structurally impossible here (see `kernel/src/lib.rs`, `web/src/engine/worker.ts`).
- **Verified twice.** Every candidate reported by the WASM kernel or the GPU is re-derived with an independent implementation (`@noble/curves` + `@noble/hashes`) in `web/src/engine/search.ts` before it is shown. The GPU must also pass a known-answer self-test on every page load (`web/src/engine/gpuRunner.ts`). Any disagreement discards the result and disables the engine.
- **Open source, MIT.** The kernel, the shader, the verification layer and the build pipeline are all in this repository. The deployed site is the unmodified output of `npm run build`.

## Speed

| Engine | Implementation | Throughput (Apple M3 Max) |
| --- | --- | --- |
| CPU | Rust → WebAssembly, one Web Worker per core, batched affine point addition (Montgomery's trick) + keccak256 | ~2.0 M keys/s per core, ~22 M/s on 14 workers |
| GPU | WebGPU compute shader (WGSL): 8×u32 field arithmetic, libsecp256k1 inversion chain, keccak-f[1600] | ~13 M keys/s (34 M/s in Chrome's headless run) |
| CREATE2 | keccak-only paths on both engines | 4.7 M salts/s per core, ~37 M/s GPU |

Both engines run at the same time. For comparison, vanity-eth runs around 15k keys/s per thread in pure JavaScript.

## Features

- Prefix, suffix, or both. Hex only, validated live.
- Optional case-sensitive matching against the EIP-55 checksummed address, with the difficulty multiplier (2× per letter) shown.
- Difficulty, expected time and 50% time computed from a benchmark of your actual device; live attempts, speed and "probability of a match by now" while running; pause, resume, stop, keep searching.
- Warnings when a pattern would take more than a day, or more than a year.
- Output: checksummed address, private key (hidden until clicked), QR codes for both, and an encrypted **V3 keystore JSON** download (scrypt + AES-128-CTR) with a user-chosen password.
- **CREATE2 mode:** supply the deployer/factory address and the init code (or its hash); 0xCairn mines the salt for a vanity contract address.
- **Split-key mode:** the requester generates a keypair locally and shares only the public key; the miner finds an offset; the requester combines `(key + offset) mod n` locally. The miner never learns the final key.
- Installable PWA, fully offline after first load.

## Repository layout

```
kernel/            Rust crate compiled to wasm32-unknown-unknown (no wasm-bindgen, zero imports)
  src/lib.rs       lane-parallel secp256k1 walker, EIP-55 check, CREATE2 miner, FFI surface, tests
web/               Vite + Preact + TypeScript app, deployed as a Cloudflare Worker with static assets
  src/gpu/kernel.wgsl     WebGPU compute kernel (address_main, create2_main)
  src/gpu/gpu.ts          DOM-free WebGPU driver
  src/gpu/test.ts         headless GPU correctness tests + benchmarks (Deno)
  src/engine/             worker.ts, cpuPool.ts, gpuRunner.ts, search.ts (verification + orchestration)
  src/lib/                kernel.ts (WASM wrapper), eth.ts (noble reference impl), keystore.ts, pattern.ts, qr.ts
  src/components/         UI
  src/kernel/cairn_kernel.wasm   committed build artefact (rebuild with scripts/build-kernel.sh)
  public/_headers         CSP and security headers served by Cloudflare
scripts/build-kernel.sh  cargo build + copy the .wasm into web/src/kernel
```

## Build

Requirements: Node 20+, Rust with `rustup target add wasm32-unknown-unknown` (only when changing the kernel).

```bash
# kernel (optional; the .wasm is committed)
cd kernel && cargo test --release && cd ..
scripts/build-kernel.sh

# web app
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ with sw.js, CSP meta and JSON-LD injected
npm run preview
```

## Tests

```bash
cd kernel && cargo test --release          # 7 kernel tests incl. EIP-1014 and key=1 vectors
cd web
npm run test:lib                           # noble/pattern/keystore/wasm cross-checks (Deno)
npm run test:gpu                           # WGSL kernel vs noble, exact (index, round) targets (Deno + WebGPU)
npm run test:gpu -- --bench                # plus throughput numbers
npm run test:e2e                           # headless Chrome: mining, pause/resume, CREATE2, split-key, CSP, SW
```

## Deploy

The site is an assets-only Cloudflare Worker (`web/wrangler.jsonc`, personal account). `_headers` is picked up from the assets directory.

```bash
cd web && npm run deploy
```

## Security notes for users

1. Load the page, then disconnect from the internet. The pill in the header turns green.
2. Download the encrypted keystore rather than copying the raw key.
3. Import into your wallet, confirm the address, send a small test amount first.
4. Never paste the private key anywhere you did not generate it.

## License

MIT, see `LICENSE`.
