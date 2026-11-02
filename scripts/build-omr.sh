#!/bin/sh
# Builds the music reader (omr-rs, on homr-rs at the revision in its
# Cargo.toml) to omr/partsong_omr.wasm with WebAssembly SIMD, and
# omr/partsong_omr_fused.wasm with relaxed SIMD as well: homr-rs's decoder
# matches homr exactly there only where the browser fuses multiply-adds,
# which the worker checks before using it.
set -e
cd "$(dirname "$0")/../omr-rs"
RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown --target-dir target/simd
cp target/simd/wasm32-unknown-unknown/release/partsong_omr.wasm ../omr/partsong_omr.wasm
RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd" cargo build --release --target wasm32-unknown-unknown --target-dir target/fused
cp target/fused/wasm32-unknown-unknown/release/partsong_omr.wasm ../omr/partsong_omr_fused.wasm
ls -l ../omr/*.wasm
