# 0xCairn

**Carve your address. Any EVM chain.**

0xCairn is a vanity address generator for Ethereum and every EVM-compatible chain, plus a cloud mining service built so that the service can never learn your key. The free generator runs entirely in your browser. Everything that needs a server (Cairn Pro, Cairn for Teams, payments) lives on separate routes and never touches the generator page's security posture.

Live: https://0xcairn.kyleniedz99.workers.dev (until a domain is chosen). A Black Mountain product.

## Trust model

- **The generator page is sealed.** No server calls during generation, no analytics, no third-party scripts, no cookies. The same strict Content Security Policy (`default-src 'none'`, same-origin only, `wasm-unsafe-eval` for the kernel) is served as a header for every route and injected as a `<meta>` tag at build time. The Worker only runs for `/api/*` (`assets.run_worker_first`); every page is served from the static asset store.
- **Works offline.** A hand-written service worker precaches the app. The header shows an online/offline pill and the UI tells you to disconnect before generating a key you will fund.
- **256-bit seeds.** Every CPU worker and every GPU batch starts from a full 256-bit scalar from `crypto.getRandomValues`, never anything smaller (the Profanity flaw).
- **Verified twice.** Every candidate from the WASM kernel or the GPU is re-derived with the independent `@noble` libraries before display. The GPU must pass a known-answer self-test on every page load. The API re-verifies every result a GPU worker submits before releasing it.
- **Cairn Pro never sees your key.** Cloud mining uses split-key mode: you generate a keypair in the browser and submit only the public key; our GPUs find an offset; you add `(half + offset) mod n` locally and the page re-verifies the address before showing it.
- **Nothing unencrypted in storage.** Optional local history encrypts results with a user password (scrypt + AES-128-CTR + keccak MAC) in IndexedDB. Run checkpoints store pattern and counts only.
- **Open source, MIT.**

## What's in the product

Free generator (`/`)
- Prefix, suffix, or both; hex validated live; optional EIP-55 case-sensitive matching with its multiplier shown.
- Live address preview as the hero: pattern lit in amber, cycling candidates while mining, settles on the match.
- Hexspeak finder ("find a word") with a curated dictionary; preset chips with ETAs.
- Probability-based difficulty (50% / 90% times), live attempts vs expected, "found by now" probability, memoryless explanation.
- Engines: one Web Worker per core (Rust → WASM) plus WebGPU, combined hashrate, 3-second re-benchmark.
- Results: checksummed address, hidden key, QR codes, encrypted V3 keystore download, hardware-wallet line (plain `rel="noopener sponsored"` links), share card (free watermarked; clean version via crypto checkout), save to encrypted history.
- CREATE2 contract mode with prefix/suffix and bit-mask targets, including a Uniswap v4 hook permissions helper.
- Split-key mode (generate, mine for someone, combine).
- Lost-run banner from a key-free checkpoint after a refresh.

Cairn Pro (`/pro/`): quote from difficulty, local keypair generation, payment in USDC (Base) or ETH (mainnet) to a per-order address derived from an xpub, or in BTC to a single address with a per-order unique satoshi amount (matched via mempool.space after one confirmation), order page with queued / mining / found status, optional email, refund policy (full refund on request past 5× the estimate), client-side combine step.

Cairn for Teams (`/teams/`): CREATE2 jobs over a REST API (`/api/v1/jobs`, `/api/v1/quote`) with API keys, prepaid or postpaid, bit-mask targets, and a CLI (`cli/cairn.mjs`).

SEO: 234 static, script-free pages generated at build time under `/vanity/`, `/hexspeak/`, `/difficulty/`, `/guides/`, each linking into the generator with the pattern prefilled, plus a sitemap.

## Repository layout

```
kernel/                  Rust crate -> wasm32 (k256 + tiny-keccak, no wasm-bindgen, zero imports)
  src/lib.rs             lane-parallel secp256k1 walker, EIP-55, bit masks, CREATE2, FFI, tests
web/                     Vite + Preact app, deployed as one Cloudflare Worker (API) + static assets
  index.html, pro/, order/, teams/, privacy/, terms/     entry pages
  src/gpu/kernel.wgsl    WebGPU kernel (address_main, create2_main)
  src/engine/            worker.ts, cpuPool.ts, gpuRunner.ts, search.ts (verification + orchestration)
  src/lib/               kernel.ts, eth.ts (noble reference impl), keystore.ts, pattern.ts, pricing.ts,
                         hexspeak.ts, history.ts, shareCard.ts, qr.ts
  src/chains/            chain module interface (EVM today; Solana/TRON plug in here)
  src/content/           faq.ts, hexspeak.ts (dictionary + presets), guides.ts
  src/components/        UI
  worker/index.ts        Hono API: quotes, orders, payments, worker queue, Teams API, admin
  worker/schema.sql      D1 schema
  gpu-worker/worker.ts   Deno GPU worker that pulls from the queue (run on rented GPUs)
  scripts/seo.ts         static page generator; e2e.mjs; icons.mjs; mine-tip.mjs
  public/_headers        CSP and security headers
cli/cairn.mjs            Teams CLI
scripts/build-kernel.sh  cargo build + copy the .wasm into web/src/kernel
```

## Build and test

```bash
cd kernel && cargo test --release && cd ..       # 8 kernel tests
scripts/build-kernel.sh                          # only after kernel changes; the .wasm is committed
cd web && npm install
npm run dev
npm run build                                    # all pages + SEO pages + sw.js
npm run test:lib                                 # noble/pattern/keystore/wasm cross-checks (Deno)
npm run test:gpu [-- --bench]                    # WGSL vs noble, exact targets (Deno + WebGPU)
npm run test:e2e                                 # headless Chrome: mining, pause/resume, CREATE2, v4 mask, split-key, CSP, SW
```

## Deploy (Cloudflare Workers)

```bash
cd web
npm run deploy
```

One-time setup: a D1 database named `0xcairn` (schema in `worker/schema.sql`), the secrets `WORKER_TOKEN` (GPU workers) and `ADMIN_TOKEN` (admin endpoints), and your own `account_id`, `SITE_URL` and `BTC_ADDRESS` in `wrangler.jsonc`. Before Pro and Teams can take USDC or ETH:

```bash
# BIP32 account-level xpub; child i receives payment for order i. Keep the xpriv offline.
npx wrangler secret put PAYMENT_XPUB
```

Bitcoin checkout works with only `BTC_ADDRESS` set (tips and payments both go to it, confirmed through mempool.space). Until `PAYMENT_XPUB` is set, `/api/health` reports `evm: false`, the USDC and ETH buttons are disabled and the Pro page defaults to BTC. Postpaid Teams keys work without any payment config.

Schema changes after the initial deploy live in `web/worker/migrations/` and are applied with `wrangler d1 execute 0xcairn --remote --file=worker/migrations/NNN.sql`.

### Running a GPU worker

On any machine with a GPU (Deno has WebGPU on Linux/macOS/Windows):

```bash
cd web && npm install
npm run worker -- --api https://0xcairn.kyleniedz99.workers.dev --token $WORKER_TOKEN --id rig-1
```

It polls the queue, mines with the same WGSL kernel as the site, verifies every hit locally, and submits results that the API verifies again.

### Admin

```bash
# issue a Teams API key (postpaid = invoiced, no payment step)
curl -X POST $SITE/api/admin/keys -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"name":"Acme","postpaid":true}'
curl $SITE/api/admin/orders   -H "Authorization: Bearer $ADMIN_TOKEN"
curl $SITE/api/admin/contacts -H "Authorization: Bearer $ADMIN_TOKEN"
```

Refunds are manual: `refund_requested_at` and `refund_address` appear on the order.

## License

MIT, see `LICENSE`.
