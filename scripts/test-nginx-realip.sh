#!/usr/bin/env bash
# Proves what the analysis server sees as the visitor's address through the real nginx image:
#   · TRUSTED_PROXY unset         → the connecting address; a sent CF-Connecting-IP is ignored
#   · TRUSTED_PROXY = the peer    → CF-Connecting-IP
#   · TRUSTED_PROXY = another one → the connecting address (the header is not believed)
#   · TRUSTED_PROXY nonsense      → nginx refuses to start
# Uses only the two images this project builds (bash scripts/docker-build.sh first); a header-echo
# server stands in for the analysis container on a private test network. Cleans up after itself.
set -euo pipefail
NET=thp-realip-test; ECHO=thp-realip-echo; WEB=thp-realip-web; PORT=18089
cleanup() { docker rm -f "$ECHO" "$WEB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT; cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$ECHO" --network "$NET" --network-alias analysis triibholz-analysis:latest \
  node -e "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({ip:q.headers['x-real-ip']||null}))}).listen(4200)" >/dev/null
fail=0
web() { docker rm -f "$WEB" >/dev/null 2>&1 || true; docker run -d --name "$WEB" --network "$NET" -p 127.0.0.1:$PORT:80 -e TRUSTED_PROXY="$1" triibholz-thplay:latest >/dev/null; for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break; sleep 0.25; done; }
seen() { sleep 0.3; curl -s -H 'CF-Connecting-IP: 203.0.113.77' "http://127.0.0.1:$PORT/api/who" | sed 's/.*"ip":"\{0,1\}\([^",}]*\).*/\1/'; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 ($2)"; else echo "  ✗ FAIL: $1 — expected $3, got $2"; fail=1; fi; }

web ""
PEER=$(seen)
check "no TRUSTED_PROXY: the connecting address, CF-Connecting-IP ignored" "$([ "$PEER" != 203.0.113.77 ] && [ -n "$PEER" ] && echo ignored || echo "$PEER")" ignored
web "$PEER";        check "TRUSTED_PROXY = the peer: the visitor's address from CF-Connecting-IP" "$(seen)" 203.0.113.77
web "10.123.45.67"; check "TRUSTED_PROXY = some other address: the header is not believed" "$(seen)" "$PEER"
docker rm -f "$WEB" >/dev/null 2>&1 || true
for bad in '0.0.0.0/0' '1.2.3.4;evil'; do
  docker run -d --name "$WEB" -e TRUSTED_PROXY="$bad" triibholz-thplay:latest >/dev/null; sleep 2
  state=$(docker inspect -f '{{.State.Running}} {{.State.ExitCode}}' "$WEB"); docker rm -f "$WEB" >/dev/null
  check "TRUSTED_PROXY='$bad': the container refuses to start" "$([ "${state%% *}" = false ] && [ "${state##* }" != 0 ] && echo refused || echo "started ($state)")" refused
done
exit $fail
