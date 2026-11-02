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
# Shared-memory builds for homr-rs's multithreaded exact encoder (used when
# the page is cross-origin isolated). Stock std can't link shared memory, so
# these rebuild it on nightly (rustup component add rust-src --toolchain nightly).
THREADS="-C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--export-memory -C link-arg=--max-memory=1073741824 -C link-arg=--export=__stack_pointer -C link-arg=--export-if-defined=__wasm_init_tls -C link-arg=--export-if-defined=__tls_size -C link-arg=--export-if-defined=__tls_align"
for v in threads:+simd128 threads_fused:+simd128,+relaxed-simd; do
  name=${v%%:*}
  RUSTFLAGS="-C target-feature=${v#*:},+atomics,+bulk-memory,+mutable-globals $THREADS" \
    cargo +nightly build -Z build-std=std,panic_abort --release --target wasm32-unknown-unknown --features threads --target-dir target/$name
  cp target/$name/wasm32-unknown-unknown/release/partsong_omr.wasm ../omr/partsong_omr_$name.wasm
done
# homr-rs's host side of the worker pool, from the same revision.
homr=$(dirname "$(cargo metadata --format-version 1 | python3 -c 'import json,sys; print(next(p["manifest_path"] for p in json.load(sys.stdin)["packages"] if p["name"]=="homr-rs"))')")
cp "$homr/tools/encoder_pool.mjs" "$homr/tools/encoder_worker.mjs" ../omr/
ls -l ../omr/*.wasm
