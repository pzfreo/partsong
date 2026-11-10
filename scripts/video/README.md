# How-to videos

The videos on the Help page are recorded from the real app, not edited by hand,
so they can be made again when the app changes:

```sh
scripts/video/make.sh getting-started    # → /tmp/partsong-video/getting-started/getting-started.mp4
scripts/video/make.sh difficult-scores
```

Each video is a folder here:

- `drive.js`: what happens on screen. It runs in the page (after `lib.js`),
  taps through the app with a dot where it taps, shows the captions, and marks
  when each voiceover line starts.
- `lines.json`: the voiceover, one line per step, keyed as `drive.js` uses them.
- `score.ly` (difficult-scores): the score it opens, in LilyPond. It's
  *In the Bleak Midwinter* (Holst, Rossetti; public domain) laid out to trip
  Partsong up. Verse 1 is on four staves, and one system has no outer bracket,
  so Partsong splits it. Verse 4 is on two staves, and two systems sit close
  together, so Partsong merges them. If a change to the reader stops making
  these mistakes, change the layout, not the video.

Shared parts:

- `make.sh`: makes the voiceover (first time only), copies this checkout to a
  stamped site, records, and builds the MP4.
- `voiceover.py`: the voiceover in OpenAI's `nova` voice with a British
  accent, as one take so the voice stays the same throughout. The take is split
  into lines with Whisper's word timings. A line the take leaves out (`nova`
  sometimes stops early) is made on its own. Needs `OPENAI_API_KEY`. Each run
  is a new take, so `make.sh` keeps it in `$OUT/NAME/vo`.
- `record.mjs`: headless Chrome as a 412×915 phone. It saves screencast frames
  while the drive has `rec(true)`, so waits such as reading are cut.
- `lib.js`: captions, the tap dot, voiceover timing, and a copy of everything
  played (from `AudioContext.destination`) for the soundtrack.
- `build.mjs`: frames, voiceover clips at their marks, and the music played
  (quieter under the voice) into an H.264 MP4.

To publish one, copy the MP4 to `video/` and update the poster (a frame at
2 s), the sitemap's `<video:duration>`, and the link text if its length
changes much.
