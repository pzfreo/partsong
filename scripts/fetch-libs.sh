#!/usr/bin/env bash
# Fetches the third-party libraries the app loads (onnxruntime-web, pdf.js,
# OSMD, mp4-muxer) into lib/, so partsong.app serves them itself: a network
# that blocks or drops a CDN can't stop the reader starting. Pinned versions,
# checked against SHA-256. The dir is gitignored.
set -euo pipefail

FILES=(
  "da6267cfe5036ae718a59eece3b5744a4655b0b8faa9f16259362b783d74c9bb tesseract.js@6.0.1/dist/tesseract.esm.min.js"
  "3dffff71811bc13a3a3d9591c57ca5ee5735b8f5f3eaf789510b02bb040ae3a0 onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs"
  "3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28 onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.asyncify.mjs"
  "39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.asyncify.wasm"
  "57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2 pdfjs-dist@6.4.299/build/pdf.min.mjs"
  "9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18 pdfjs-dist@6.4.299/build/pdf.worker.min.mjs"
  "86e439e5ec1c0cbf8b7051e0cf32291d377fb97cf6b8976b9ef87c714e0ca032 opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js"
  "d2c4c782f180c86ed30b1f5d9487a34a0d370bf9b4535285734ea187d38f9bb5 mp4-muxer@5.2.2/build/mp4-muxer.mjs"
)

cd "$(dirname "$0")/.."
for entry in "${FILES[@]}"; do
  sum=${entry%% *}; path=${entry#* }
  file="lib/$path"
  if [ ! -f "$file" ] || [ "$(shasum -a 256 "$file" | cut -d' ' -f1)" != "$sum" ]; then
    mkdir -p "$(dirname "$file")"
    curl -fsSL -o "$file" "https://cdn.jsdelivr.net/npm/$path"
    got=$(shasum -a 256 "$file" | cut -d' ' -f1)
    [ "$got" = "$sum" ] || { echo "Checksum mismatch for $path: $got"; rm -f "$file"; exit 1; }
  fi
done
du -sh lib
