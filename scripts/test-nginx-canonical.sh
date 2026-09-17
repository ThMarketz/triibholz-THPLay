#!/usr/bin/env bash
# Proves the canonical-host redirect in the real nginx image:
#   · CANONICAL_HOST unset        → every hostname is served (development is untouched)
#   · CANONICAL_HOST = thplay.ch  → that host is served; www, an old domain and a bare IP are 301'd
#                                   to it, keeping the path and query
#   · CANONICAL_HOST nonsense     → nginx refuses to start
# Why it matters: `server_name _` serves the app to any hostname, but the server's Origin check
# knows only the canonical origin — so a second hostname looks perfectly healthy and then refuses
# every invite code, and being a second browser origin it also gets its own storage and passkeys.
# Build first: bash scripts/docker-build.sh
set -euo pipefail
WEB=thp-canon-web; PORT=18091
cleanup() { docker rm -f "$WEB" >/dev/null 2>&1 || true; }
trap cleanup EXIT; cleanup
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  \xe2\x9c\x93 %s\n' "$1"; else fail=$((fail+1)); printf '  \xe2\x9c\x97 FAIL: %s (got %s, want %s)\n' "$1" "$2" "$3"; fi; }

start() { # $1 = CANONICAL_HOST value ("" to leave unset)
  docker rm -f "$WEB" >/dev/null 2>&1 || true
  if [ -z "$1" ]; then docker run -d --name "$WEB" -p "127.0.0.1:$PORT:80" triibholz-thplay:latest >/dev/null
  else docker run -d --name "$WEB" -e CANONICAL_HOST="$1" -p "127.0.0.1:$PORT:80" triibholz-thplay:latest >/dev/null; fi
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && return 0; sleep 0.25; done
  return 1
}
code() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "http://127.0.0.1:$PORT$2"; }
dest() { curl -s -o /dev/null -w '%{redirect_url}' -H "Host: $1" "http://127.0.0.1:$PORT$2"; }

echo "[1] CANONICAL_HOST unset — development is untouched"
start "" || { echo "container did not come up"; exit 1; }
ok "any hostname is served"            "$(code www.thplay.ch /)"    200
ok "…including a bare address"         "$(code 192.168.1.50 /)"     200

echo "[2] CANONICAL_HOST=thplay.ch"
start thplay.ch || { echo "container did not come up"; exit 1; }
ok "the canonical host is served"      "$(code thplay.ch /)"                 200
ok "www is redirected"                 "$(code www.thplay.ch /)"             301
ok "…to the canonical host, keeping the path and query" \
   "$(dest www.thplay.ch '/x/y?z=1')"  "https://thplay.ch/x/y?z=1"
ok "an old domain is redirected"       "$(code triibholz.ch /)"              301
ok "a bare address is redirected"      "$(code 192.168.1.50 /)"              301
ok "the API is redirected too, before it can answer" "$(code www.thplay.ch /api/health)" 301

echo "[3] a nonsense value stops nginx rather than guessing"
docker rm -f "$WEB" >/dev/null 2>&1 || true
docker run -d --name "$WEB" -e CANONICAL_HOST='not a host; rm -rf /' -p "127.0.0.1:$PORT:80" triibholz-thplay:latest >/dev/null || true
sleep 2
running=$(docker inspect -f '{{.State.Running}}' "$WEB" 2>/dev/null || echo false)
ok "nginx refuses to start"            "$running"                            false

printf '\n==== %s passed, %s failed ====\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
