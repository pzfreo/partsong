#!/usr/bin/env bash
# Fetches homr's fp32 ONNX models (from homr's releases) into models/, which
# the browser worker loads. The dir is gitignored.
set -euo pipefail

BASE_URL=https://github.com/liebharc/homr/releases/download/onnx_checkpoints
MODELS=(
  segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f
  encoder_pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31
  decoder_pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31
)

cd "$(dirname "$0")/.."
mkdir -p models
for m in "${MODELS[@]}"; do
  if [ ! -f "models/$m.onnx" ]; then
    echo "Downloading $m"
    # GitHub release downloads sometimes fail for a while (504s): keep trying.
    curl -fsSL --retry 8 --retry-delay 15 --retry-all-errors -o "models/$m.zip" "$BASE_URL/$m.zip"
    unzip -o -q -j "models/$m.zip" '*.onnx' -d models
    rm "models/$m.zip"
  fi
done

# The worker (omr-worker.js) hard-codes each model's byte size and the total:
# a wrong one fails every download on a device, so check them against the files.
sizes=$(grep -oE 'MODELS\[[0-9]\]\]: [0-9]+' omr-worker.js | grep -oE '[0-9]+$')
total=$(grep -oE 'MODELS_TOTAL_BYTES = [0-9]+' omr-worker.js | grep -oE '[0-9]+$')
i=0; sum=0
for m in "${MODELS[@]}"; do
  want=$(echo "$sizes" | sed -n "$((i + 1))p"); have=$(wc -c < "models/$m.onnx" | tr -d ' ')
  [ "$want" = "$have" ] || { echo "omr-worker.js says $m is $want bytes; the file is $have" >&2; exit 1; }
  sum=$((sum + have)); i=$((i + 1))
done
[ "$sum" = "$total" ] || { echo "omr-worker.js MODELS_TOTAL_BYTES is $total; the models add up to $sum" >&2; exit 1; }

ls -la models
