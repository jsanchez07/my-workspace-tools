#!/usr/bin/env bash
# Double-check CDN hints. Uses TARGET_HOST — NOT HOST — because zsh's $HOST is special
# and overwriting it changes your prompt (e.g. user@humana) until you unset HOST or new terminal.

URL="${1:-https://metrobyt-mobile.com}"

echo "=== Response headers (CDN hints) ==="
curl -sI -L --max-time 15 -A "Mozilla/5.0" "$URL"

echo ""
echo "=== IPv4 for hostname ==="
TARGET_HOST="$(printf '%s' "$URL" | sed -E 's#^https?://##; s#/.*##')"
dig +short "$TARGET_HOST" A

echo ""
echo "=== PTR for first IPv4 (if any) ==="
IP="$(dig +short "$TARGET_HOST" A | grep -E '^[0-9.]+$' | head -1)"
if [ -n "$IP" ]; then
  dig +short -x "$IP"
else
  echo "(no A record from dig)"
fi
