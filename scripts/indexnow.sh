#!/bin/sh
# Tells IndexNow (Bing, Yandex and others) which of partsong.app's public
# pages changed, so they're crawled again within hours, not weeks.
#   scripts/indexnow.sh all              every page in sitemap.xml
#   scripts/indexnow.sh <from> <to>      pages in the sitemap changed between two commits
# DRY=1: print the pages, send nothing.
# The key is the name of the one *.txt file at the top of the repo whose
# contents are its own name (served at https://partsong.app/<key>.txt).
cd "$(dirname "$0")/.." || exit 1
KEY=$(for f in *.txt; do [ "$(cat "$f")" = "${f%.txt}" ] && echo "${f%.txt}"; done | head -1)
[ -n "$KEY" ] || { echo "No IndexNow key file"; exit 1; }
SITE=https://partsong.app
pages=$(grep -o '<loc>[^<]*' sitemap.xml | sed 's/<loc>//')
if [ "$1" != all ]; then
  # (index.html is the home page, "$SITE/" in the sitemap.)
  changed=$(git diff --name-only "$1" "$2" -- '*.html' | sed 's#^index\.html$#HOME#')
  pages=$(for f in $changed; do [ "$f" = HOME ] && f=; echo "$pages" | grep -x "$SITE/$f"; done | sort -u)
fi
[ -n "$pages" ] || { echo "No public pages changed"; exit 0; }
urls=$(echo "$pages" | sed 's/.*/"&"/' | paste -sd, -)
echo "$pages"
[ -n "$DRY" ] && { echo "(dry run: not sent)"; exit 0; }
curl -sS -o /dev/null -w "IndexNow: HTTP %{http_code}\n" -X POST https://api.indexnow.org/indexnow \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"partsong.app\",\"key\":\"$KEY\",\"keyLocation\":\"$SITE/$KEY.txt\",\"urlList\":[$urls]}"
