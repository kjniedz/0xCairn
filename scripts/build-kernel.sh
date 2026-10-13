#!/usr/bin/env bash
# Builds the Rust mining kernel to WebAssembly and copies it into the web app.
# Requires: rustup target add wasm32-unknown-unknown
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/kernel"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/cairn_kernel.wasm "$ROOT/web/src/kernel/cairn_kernel.wasm"
ls -la "$ROOT/web/src/kernel/cairn_kernel.wasm"
