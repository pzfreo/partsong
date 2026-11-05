#!/bin/sh
# Checks Partsong's reading of the CPDL test scores against their editions'
# MusicXML. Each score is testdata/corpus/NAME.pdf with NAME.xml (unzip a
# .mxl to get it). Needs the local server (http://localhost:8765).
#   scripts/corpus-check.sh [NAME ...]   (default: every PDF there)
# Results go to $OUT (default /tmp/partsong-corpus): NAME.json, and a summary.
cd "$(dirname "$0")/.." || exit 1
OUT=${OUT:-/tmp/partsong-corpus}; mkdir -p "$OUT"
[ $# -eq 0 ] && set -- $(ls testdata/corpus/*.pdf | grep -v partsong | xargs -n1 basename | sed 's/\.pdf$//')
files=""
for n in "$@"; do
  files="$files $OUT/$n.json"
  sed "s/__NAME__/$n/" tests/drive-corpus.tmpl.js > "$OUT/drive-$n.js"
  rm -f "$OUT/$n.json"
  # A Chrome still closing from the last score breaks the next start: wait it out, retry once.
  for try in 1 2; do
    pkill -f "remote-debugging-port=9333"
    while pgrep -f "remote-debugging-port=9333" > /dev/null; do sleep 1; done
    node scripts/headless-test.mjs http://localhost:8765/index.html "$OUT/$n.json" 1850 "$OUT/drive-$n.js" > "$OUT/$n.log" 2>&1
    [ -f "$OUT/$n.json" ] && break
  done
done
python3 -I scripts/corpus-summary.py $files
