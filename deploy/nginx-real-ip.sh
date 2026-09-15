#!/bin/sh
# Runs at container start (the nginx image executes /docker-entrypoint.d/*.sh).
#
# Behind a tunnel (Cloudflare → cloudflared → nginx) every visitor reaches nginx from the tunnel's
# address, so rate limits keyed on "the client address" would treat the whole world as one client.
# TRUSTED_PROXY names the tunnel's address(es) — comma-separated addresses or CIDRs. nginx then
# takes the visitor's address from CF-Connecting-IP, and only on connections from those addresses:
# anyone else sending that header is ignored.
#
# Unset (local development): nginx uses the connecting address and CF-Connecting-IP means nothing.
# Trust only the tunnel's own fixed address — never a range that other machines share (on Docker
# Desktop, 192.168.65.1 is every host-routed connection, LAN included). See docs/ACCOUNTS.md.
set -eu
out=/etc/nginx/triibholz-real-ip.inc
: > "$out"
[ -z "${TRUSTED_PROXY:-}" ] && exit 0
for p in $(echo "$TRUSTED_PROXY" | tr ',' ' '); do
  case "$p" in
    *[!0-9A-Fa-f:./]*) echo "TRUSTED_PROXY: '$p' is not an address or CIDR — refusing to start" >&2; exit 1 ;;
    0.0.0.0/0|::/0|*/[0-7]) echo "TRUSTED_PROXY: '$p' would trust almost everyone — refusing to start" >&2; exit 1 ;;
  esac
  echo "set_real_ip_from $p;" >> "$out"
done
printf 'real_ip_header CF-Connecting-IP;\nreal_ip_recursive off;\n' >> "$out"
echo "triibholz: visitor addresses from CF-Connecting-IP, trusted only from $TRUSTED_PROXY"
