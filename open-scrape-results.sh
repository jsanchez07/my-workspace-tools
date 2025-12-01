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

# Navigate to spacecat-content-scraper directory
SCRAPER_DIR="$SPACECAT_SCRAPER_DIR"

if [ ! -d "$SCRAPER_DIR" ]; then
    echo "Error: Scraper directory not found at $SCRAPER_DIR"
    echo ""
    echo "Please check your configuration:"
    echo "  code $CONFIG_FILE"
    echo "Or re-run setup:"
    echo "  ./setup-spacecat-tools.sh"
    echo ""
    exit 1
fi

cd "$SCRAPER_DIR" || exit 1

# Find all scrape.json files
scrape_files=($(find tmp -name "scrape.json" -type f 2>/dev/null))
count=${#scrape_files[@]}

if [ $count -eq 0 ]; then
    echo "No scrape.json files found in tmp/"
    exit 1
fi

echo "Found $count scrape.json file(s)"

if [ $count -lt 5 ]; then
    echo "Opening all $count file(s)..."
    for file in "${scrape_files[@]}"; do
        echo "Opening: $file"
        open "$file"
        sleep 0.5  # Small delay between opens
    done
else
    echo "Found 5 or more files. Opening only the first one:"
    echo "Opening: ${scrape_files[0]}"
    open "${scrape_files[0]}"
    echo ""
    echo "Other files available:"
    for file in "${scrape_files[@]:1}"; do
        echo "  - $file"
    done
fi

echo ""
echo "Done!"

