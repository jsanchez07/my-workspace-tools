#!/bin/bash

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/spacecat-config.sh"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Configuration file not found!"
    echo ""
    echo "Please run setup first:"
    echo "  cd $SCRIPT_DIR"
    echo "  ./setup-spacecat-tools.sh"
    echo ""
    exit 1
fi

source "$CONFIG_FILE"

# Configuration
API_URL="https://spacecat.experiencecloud.live/api/ci/sites"
URLS_FILE="$SPACECAT_TOOLS_DIR/urls-to-scrape.txt"
TEMP_FILE="/tmp/top-pages.json"

# Try to get API key from config or environment
API_KEY="${SPACECAT_API_KEY:-}"

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

# Prompt for Site ID
echo "Enter the Site ID to fetch top pages for:"
echo ""
read -p "Site ID: " SITE_ID

if [ -z "$SITE_ID" ]; then
    echo "❌ Error: Site ID is required"
    exit 1
fi

# Prompt for API Key if not in environment
if [ -z "$API_KEY" ]; then
    echo ""
    echo "API Key not found in environment (SPACECAT_API_KEY)"
    echo ""
    read -p "Enter API key: " API_KEY
    
    if [ -z "$API_KEY" ]; then
        echo "❌ Error: API key is required"
        exit 1
    fi
    
    # Ask if they want to save it for future use
    echo ""
    read -p "Save API key to environment for this session? (y/N): " SAVE_KEY
    if [[ "$SAVE_KEY" =~ ^[Yy] ]]; then
        export SPACECAT_API_KEY="$API_KEY"
        echo "✅ API key saved to SPACECAT_API_KEY for this session"
        echo "   To make permanent, add to your ~/.zshrc or ~/.bashrc:"
        echo "   export SPACECAT_API_KEY=\"$API_KEY\""
    fi
else
    echo "✅ Using API key from SPACECAT_API_KEY environment variable"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
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

echo "✅ Downloaded top pages to $TEMP_FILE"

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
echo "✅ Ready to run scraper!"
echo ""
echo "Next steps:"
echo "  1. Review the URLs in: $URLS_FILE"
echo "  2. Run: ./run-scraper.sh (will use these URLs automatically)"
echo ""

# Offer to run scraper immediately
read -p "Run scraper now? (y/N): " RUN_SCRAPER
if [[ "$RUN_SCRAPER" =~ ^[Yy] ]]; then
    echo ""
    echo "🚀 Starting scraper..."
    echo "═══════════════════════════════════════════════════════════════"
    ./run-scraper.sh
else
    echo ""
    echo "Done! Run './run-scraper.sh' when ready."
fi

# Clean up temp file
rm -f "$TEMP_FILE"

