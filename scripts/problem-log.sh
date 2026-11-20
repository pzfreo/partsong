#!/bin/bash
# The problem log (relay/index.js, POST /log): what the app reported going wrong.
#   scripts/problem-log.sh                 the last 2 days, one line a record
#   scripts/problem-log.sh 7               the last 7 days
#   scripts/problem-log.sh visit <id>      everything from one visit, in full
#   scripts/problem-log.sh sql "<query>"   any query on the log table (relay/schema.sql)
# Add --local as the last argument for the local database wrangler dev uses.
cd "$(dirname "$0")/../relay" || exit 1
where=--remote
for a in "$@"; do [ "$a" = --local ] && where=--local; done
run() { npx wrangler d1 execute partsong-log $where --json --command "$1" | python3 -c '
import json, sys
rows = json.load(sys.stdin)[0]["results"]
full = sys.argv[1] == "full"
for r in rows:
    if full:
        print("=" * 60)
        for k, v in r.items():
            if v not in (None, ""): print(f"{k}: {v}" if "\n" not in str(v) else f"{k}:\n  " + str(v).replace("\n", "\n  "))
    else:
        print(" | ".join(str(v) for v in r.values() if v is not None))
print(f"({len(rows)} records)")' "$2"; }
case "$1" in
  visit) run "SELECT datetime(at/1000,'unixepoch') AS time, kind, version, device, stage, message, place, detail, reader, browser FROM log WHERE visit = '${2//[^A-Za-z0-9-]/}' ORDER BY at" full ;;
  sql) run "$2" full ;;
  *) days=$(( ${1//[^0-9]/} + 0 )); [ "$days" -gt 0 ] || days=2
     run "SELECT datetime(at/1000,'unixepoch') AS time, visit, kind, device || ' ' || version AS on_, stage, substr(message,1,110) AS message FROM log WHERE at > (strftime('%s','now') - $days*86400)*1000 ORDER BY at" line ;;
esac
