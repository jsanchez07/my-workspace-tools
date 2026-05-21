#!/usr/bin/env bash
# Starts the SpaceCat Local Dev webapp.
# Usage: ./start-webapp.sh [port]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$SCRIPT_DIR/webapp"

PORT="${1:-3333}"

if [ ! -d "$WEBAPP_DIR/node_modules" ]; then
  echo "Installing dependencies…"
  cd "$WEBAPP_DIR"
  npm install --registry https://registry.npmjs.org
fi

echo ""
echo "  SpaceCat Local Dev"
echo "  ────────────────────────────────────────"
echo "  http://localhost:$PORT"
echo "  Press Ctrl+C to stop"
echo ""

# Open browser once the server is accepting connections
(
  for i in $(seq 1 20); do
    sleep 0.3
    if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
      open "http://localhost:$PORT"
      break
    fi
  done
) &

cd "$WEBAPP_DIR"
PORT="$PORT" node server.js
