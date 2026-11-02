#!/usr/bin/env bash
# Fetches homr's fp32 ONNX models (from homr's releases) into models/, which
# the browser worker loads. The dir is gitignored.
set -euo pipefail

BASE_URL=https://github.com/liebharc/homr/releases/download/onnx_checkpoints
MODELS=(
  segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f
  encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6
  decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6
)

cd "$(dirname "$0")/.."
mkdir -p models
for m in "${MODELS[@]}"; do
  if [ ! -f "models/$m.onnx" ]; then
    echo "Downloading $m"
    curl -fsSL -o "models/$m.zip" "$BASE_URL/$m.zip"
    unzip -o -q -j "models/$m.zip" '*.onnx' -d models
    rm "models/$m.zip"
  fi
done
ls -la models
