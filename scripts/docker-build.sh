#!/usr/bin/env bash
# Reliable Docker build for Triibholz.
#
# This project lives in iCloud Drive, and Docker's build context does not
# reliably pick up newly-added files from an iCloud folder (BuildKit can miss
# them even with --no-cache). So we stage a clean copy to local /tmp, build the
# image there, then (re)create the container from that image.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="/private/tmp/triibholz-build"
IMAGE="triibholz-thplay:latest"

echo "› staging → $STAGE"
rm -rf "$STAGE"; mkdir -p "$STAGE"
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.DS_Store' "$SRC/" "$STAGE/"

echo "› building $IMAGE"
docker build -t "$IMAGE" "$STAGE"

echo "› (re)creating container"
( cd "$SRC" && docker compose up -d --no-build --force-recreate )

echo "✓ up at http://localhost:8088"
