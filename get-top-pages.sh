#!/bin/bash

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/spacecat-config.sh"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Configuration file not found!"
    exit 1
fi

# Save env vars passed by the webapp BEFORE sourcing config (which would overwrite them)
_PRE_API_KEY="${SPACECAT_API_KEY:-}"
_PRE_API_URL="${SPACECAT_API_URL:-}"

source "$CONFIG_FILE"

# Restore webapp-provided values if they were set (they take priority over config defaults)
[ -n "$_PRE_API_KEY" ] && SPACECAT_API_KEY="$_PRE_API_KEY"
[ -n "$_PRE_API_URL" ] && SPACECAT_API_URL="$_PRE_API_URL"

# Configuration — use SPACECAT_API_URL from env if set (passed by webapp), otherwise default to stage
API_URL="${SPACECAT_API_URL:-https://spacecat.experiencecloud.live/api/ci/sites}"
URLS_FILE="$SPACECAT_TOOLS_DIR/local-data/urls-to-scrape.txt"
TEMP_FILE="/tmp/top-pages.json"
NON_INTERACTIVE="${NON_INTERACTIVE:-false}"

# Ensure local-data directory exists
mkdir -p "$SPACECAT_TOOLS_DIR/local-data"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              GET TOP 200 PAGES FROM SPACECAT               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is not installed"
    echo "   Install with: brew install jq"
    exit 1
fi

# Site ID — use env var if set, otherwise prompt
if [ -z "$SITE_ID" ]; then
    if [ "$NON_INTERACTIVE" = "true" ]; then
        echo "❌ Error: SITE_ID is required"
        exit 1
    fi
    echo "Enter the Site ID to fetch top pages for:"
    echo ""
    read -p "Site ID: " SITE_ID
    if [ -z "$SITE_ID" ]; then
        echo "❌ Error: Site ID is required"
        exit 1
    fi
fi

# API key — use env var if set, otherwise prompt
API_KEY="${SPACECAT_API_KEY:-}"
if [ -z "$API_KEY" ]; then
    if [ "$NON_INTERACTIVE" = "true" ]; then
        echo "❌ Error: No API key found. Set SPACECAT_API_KEY_STAGE or SPACECAT_API_KEY_PROD in spacecat-config.sh"
        exit 1
    fi
    echo ""
    echo "API Key not found in environment"
    echo ""
    read -p "Enter API key: " API_KEY
    if [ -z "$API_KEY" ]; then
        echo "❌ Error: API key is required"
        exit 1
    fi
fi

echo "Fetching top pages for site: $SITE_ID"
echo "API: $API_URL/$SITE_ID/top-pages"
echo ""

# Make the API request
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$TEMP_FILE" \
  -H "x-api-key: $API_KEY" \
  "$API_URL/$SITE_ID/top-pages")

if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ Error: API request failed with HTTP status $HTTP_CODE"
    if [ -f "$TEMP_FILE" ]; then
        echo "Response:"
        cat "$TEMP_FILE"
        rm "$TEMP_FILE"
    fi
    exit 1
fi

echo "✅ Downloaded top pages"

# Check if response is valid JSON
if ! jq empty "$TEMP_FILE" 2>/dev/null; then
    echo "❌ Error: Response is not valid JSON"
    cat "$TEMP_FILE"
    rm "$TEMP_FILE"
    exit 1
fi

# Count pages
PAGE_COUNT=$(jq 'length' "$TEMP_FILE")
echo "   Found $PAGE_COUNT pages"

# Extract URLs
echo ""
echo "📄 Extracting URLs..."
jq -r '.[] | .url' "$TEMP_FILE" > "$URLS_FILE"

URL_COUNT=$(wc -l < "$URLS_FILE" | xargs)
echo "✅ Extracted $URL_COUNT URLs to:"
echo "   $URLS_FILE"

# Show sample URLs
echo ""
echo "📋 First 10 URLs:"
echo "─────────────────────────────────────────────────────────────"
head -10 "$URLS_FILE"
echo "─────────────────────────────────────────────────────────────"

if [ "$URL_COUNT" -gt 10 ]; then
    echo "... and $((URL_COUNT - 10)) more"
fi

# Show top pages with traffic if available
echo ""
echo "📊 Top 10 pages by traffic:"
echo "─────────────────────────────────────────────────────────────"
jq -r 'sort_by(-.traffic) | .[:10] | .[] | "\(.traffic // "N/A") visits - \(.url)"' "$TEMP_FILE"
echo "─────────────────────────────────────────────────────────────"

echo ""
echo "✅ Done! URLs saved to local-data/urls-to-scrape.txt"
echo ""

# Offer to run scraper — only in interactive mode
if [ "$NON_INTERACTIVE" != "true" ]; then
    read -p "Run scraper now? (y/N): " RUN_SCRAPER
    if [[ "$RUN_SCRAPER" =~ ^[Yy] ]]; then
        echo ""
        echo "🚀 Starting scraper..."
        echo "═══════════════════════════════════════════════════════════════"
        ./run-scraper.sh
    else
        echo "Done! Run './run-scraper.sh' when ready."
    fi
fi

# Clean up temp file
rm -f "$TEMP_FILE"
