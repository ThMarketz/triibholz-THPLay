#!/bin/sh
# Write /etc/nginx/triibholz-canonical.inc from CANONICAL_HOST.
#
# Set CANONICAL_HOST=thplay.ch and every other hostname that reaches this container — www, an old
# domain, a tunnel's own address, a bare IP — is 301'd to it before the app is served. Unset, the
# file defines an always-empty variable and nothing redirects, which is what local development and
# the test suites want.
set -eu
OUT=/etc/nginx/triibholz-canonical.inc
if [ -z "${CANONICAL_HOST:-}" ]; then
  printf 'map $host $canonical_redirect { default ""; }\n' > "$OUT"
  echo "[triibholz] no CANONICAL_HOST — every hostname is served as-is (development)"
  exit 0
fi
case "$CANONICAL_HOST" in
  *[!a-z0-9.-]*|-*|.*|*.) echo "[triibholz] CANONICAL_HOST \"$CANONICAL_HOST\" is not a hostname" >&2; exit 1 ;;
esac
{
  printf 'map $host $canonical_redirect {\n'
  printf '  default          "https://%s$request_uri";\n' "$CANONICAL_HOST"
  printf '  "%s"             "";\n' "$CANONICAL_HOST"
  printf '  ""               "";\n'
  printf '}\n'
} > "$OUT"
echo "[triibholz] canonical host: $CANONICAL_HOST (everything else is redirected to it)"
