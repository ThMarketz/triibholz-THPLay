#!/usr/bin/env bash
# Proves, in the real nginx image, that a path which NAMES A FILE resolves to that file or 404s —
# and never falls through to the HTML shell.
#
# Why it matters: `try_files $uri $uri/ /index.html` is right for navigation and wrong for assets.
# Measured before the fix, /icons/typo.png did 404 (the static regex claimed it) but /data/typo.json
# and /favicon.ico answered 200 text/html, because neither extension was listed. data/rules.json is
# PRECACHED by the service worker, so a rule book that moved or was misspelt would not fail
# anywhere: cache.addAll() would succeed, the shell would be stored under a .json URL, and coaches
# would carry an HTML page as their rule book until the cache was thrown away.
#
# The last check is the one that matters: every URL sw.js precaches must come back as something
# other than the shell.
# Build first: bash scripts/docker-build.sh
set -euo pipefail
WEB=thp-assets-web; PORT=18092
cleanup() { docker rm -f "$WEB" >/dev/null 2>&1 || true; }
trap cleanup EXIT; cleanup
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  \xe2\x9c\x93 %s\n' "$1"; else fail=$((fail+1)); printf '  \xe2\x9c\x97 FAIL: %s (got %s, want %s)\n' "$1" "$2" "$3"; fi; }

docker run -d --name "$WEB" -p "127.0.0.1:$PORT:80" triibholz-thplay:latest >/dev/null
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.25; done

code()  { curl -s -o /dev/null -w '%{http_code}'    "http://127.0.0.1:$PORT$1"; }
ctype() { curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$PORT$1"; }
cc()    { curl -sI "http://127.0.0.1:$PORT$1" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}'; }

echo "[1] real assets are served, with the right type"
ok "an icon"          "$(ctype /icons/icon-192.png)"      image/png
ok "the manifest"     "$(ctype /manifest.webmanifest)"    application/manifest+json
ok "the rule book"    "$(ctype /data/rules.json)"         application/json

echo "[2] a path that names a file 404s rather than answering with the shell"
for p in /icons/typo.png /data/typo.json /js/typo.js /css/typo.css /img/typo.svg /favicon.ico /fonts/typo.woff2; do
  ok "$p" "$(code $p)" 404
done

echo "[3] navigation still falls through to the shell (this is a single-page app)"
ok "an unknown page is the app"   "$(code /some/deep/page)"        200
ok "…and it really is the shell"  "$(ctype /some/deep/page)"       "text/html"

echo "[4] caching: long for code and art, short for the rule book"
ok "an icon is cached for a week" "$(cc /icons/icon-192.png)"      "public, max-age=604800"
ok "the rule book is not"         "$(cc /data/rules.json)"         ""

echo "[5] every URL the service worker precaches resolves to something that is not the shell"
bad=0
for u in $(node -e "
const fs=require('fs');
const m=fs.readFileSync(process.argv[1],'utf8').match(/const ASSETS = \[([\s\S]*?)\];/)[1];
console.log([...m.matchAll(/'([^']+)'/g)].map(x=>x[1].replace(/^\./,'')).join(' '));
" "$(dirname "$0")/../sw.js"); do
  c=$(code "$u"); t=$(ctype "$u")
  # './' and './index.html' ARE the shell and are meant to be html; nothing else may be
  if [ "$u" = "/" ] || [ "$u" = "/index.html" ]; then continue; fi
  if [ "$c" != "200" ] || [ "$t" = "text/html" ]; then
    printf '     %s -> %s %s\n' "$u" "$c" "$t"; bad=$((bad+1))
  fi
done
ok "no precached URL answers 404 or hands back the HTML shell" "$bad" 0

printf '\n==== %s passed, %s failed ====\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
