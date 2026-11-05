# Summarises scripts/corpus-check.sh results: bars, systems, and per voice the
# reader's line with most of its pitches (and any constant shift, e.g. a clef).
import json,sys
for f in sys.argv[1:]:
    r=json.load(open(f))
    if "error" in r: print(r["name"],"ERROR",r["error"]); continue
    b,s=r["bars"],r["systems"]
    print(f'{r["name"]}: {r["pages"]}p {r["secs"]}s bars {b["read"]}/{b["truth"]} systems {s["read"]}/{s["truth"]} lines {r["lines"]}')
    for p in r["parts"]:
        sh=p.get("shifted"); x=f'  | shifted {sh["semitones"]:+d} on {sh["line"]}: {sh["matched"]}%' if sh else ""
        print(f'    {p["part"]} ({p["notes"]}) -> {p["line"]}: {p["pitchesMatched"]}%{" (octave "+p["octaveOut"]+")" if p.get("octaveOut") else ""}{x}')
