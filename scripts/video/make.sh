#!/bin/sh
# Makes one of the how-to videos: scripts/video/make.sh NAME  (getting-started, difficult-scores)
# Records scripts/video/NAME/drive.js in headless Chrome (a 412x915 phone) against
# a stamped copy of this checkout, then builds $OUT/NAME/NAME.mp4 with the
# voiceover and the music recorded as it played. Needs OPENAI_API_KEY the first
# time (the voiceover is kept in $OUT/NAME/vo; delete that to make a new one),
# ffmpeg, and lilypond for a NAME with a score.ly.
set -e
cd "$(dirname "$0")/../.."
NAME=${1:?usage: make.sh NAME}; HERE=$PWD/scripts/video; OUT=${OUT:-/tmp/partsong-video}/$NAME
mkdir -p "$OUT"
if [ ! -f "$OUT/vo/durations.json" ]; then
  mkdir -p "$OUT/vo"; cp "$HERE/$NAME/lines.json" "$OUT/vo/"
  (cd "$OUT/vo" && python3 -I "$HERE/voiceover.py")
fi
# The site as it would be deployed, stamped with this checkout's version.
rm -rf "$OUT/site"
rsync -a --exclude .git --exclude testdata --exclude tests --exclude shots --exclude node_modules ./ "$OUT/site/"
node scripts/stamp-version.mjs "$OUT/site" "$(git rev-list --count HEAD)" > /dev/null
if [ -f "$HERE/$NAME/score.ly" ]; then
  lilypond -s -o "$OUT/score" "$HERE/$NAME/score.ly"
  mkdir -p "$OUT/site/video-demo"; cp "$OUT/score.pdf" "$OUT/site/video-demo/score.pdf"
fi
python3 -m http.server 8798 --directory "$OUT/site" > /dev/null 2>&1 &
SERVER=$!; trap 'kill $SERVER' EXIT; sleep 1
{ printf 'const VO = %s;\n' "$(cat "$OUT/vo/durations.json")"; cat "$HERE/lib.js" "$HERE/$NAME/drive.js"; } > "$OUT/drive-run.js"
rm -rf "$OUT/frames"
node "$HERE/record.mjs" http://localhost:8798/index.html "$OUT/drive-run.js" "$OUT/frames"
node "$HERE/build.mjs" "$OUT/frames" "$OUT/vo" "$OUT/$NAME.mp4"
echo "$OUT/$NAME.mp4"
