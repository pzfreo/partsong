#!/bin/sh
# Builds the music reader (omr-rs, on homr-rs at the revision in its
# Cargo.toml) to omr/partsong_omr.wasm.
set -e
cd "$(dirname "$0")/../omr-rs"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/partsong_omr.wasm ../omr/partsong_omr.wasm
ls -l ../omr/partsong_omr.wasm
