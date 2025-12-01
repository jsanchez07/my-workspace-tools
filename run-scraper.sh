#!/bin/bash

# Cleanup function to restore files if script exits early
cleanup_on_exit() {
    cd "$SCRAPER_DIR" 2>/dev/null || return
    
    # Restore abstract-handler.js if it was patched
    if [ -f "src/handlers/abstract-handler.js.backup" ]; then
        echo ""
        echo "🔄 Restoring abstract-handler.js (cleanup)..."
        mv src/handlers/abstract-handler.js.backup src/handlers/abstract-handler.js
        echo "✅ abstract-handler.js restored"
    fi
}

# Set trap to cleanup on exit (Ctrl+C, error, or normal exit)
trap cleanup_on_exit EXIT INT TERM

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

SCRAPER_DIR="$SPACECAT_SCRAPER_DIR"
URL_FILE="$SPACECAT_TOOLS_DIR/urls-to-scrape.txt"

# ============================================================================
# SYNC: Copy master local.js from central repo to scraper
# ============================================================================
echo "🔄 Syncing local.js from central repo..."
if [ -f "$SPACECAT_TOOLS_DIR/local.js" ]; then
    cp "$SPACECAT_TOOLS_DIR/local.js" "$SCRAPER_DIR/local.js"
    echo "✅ Synced latest local.js from my-workspace-tools"
    echo ""
else
    echo "⚠️  Warning: $SPACECAT_TOOLS_DIR/local.js not found"
    echo "   Using existing file in scraper"
    echo ""
fi

if [ ! -d "$SCRAPER_DIR" ]; then
    echo "Error: Scraper directory not found at $SCRAPER_DIR"
    exit 1
fi

# Read URLs from file if no arguments provided
if [ $# -eq 0 ]; then
    if [ ! -f "$URL_FILE" ]; then
        echo "Error: No URLs provided and $URL_FILE not found"
        echo ""
        echo "Usage:"
        echo "  1. Edit urls-to-scrape.txt and add URLs (one per line)"
        echo "     Then run: $0"
        echo ""
        echo "  2. Or pass URLs as arguments:"
        echo "     $0 https://example.com https://example.com/page2"
        exit 1
    fi
    
    echo "Reading URLs from: $URL_FILE"
    # Read URLs from file, skip empty lines and comments (works in bash and zsh)
    urls=()
    while IFS= read -r line; do
        # Skip comments and empty lines
        if [[ ! "$line" =~ ^# ]] && [[ -n "$line" ]]; then
            urls+=("$line")
        fi
    done < "$URL_FILE"
    
    if [ ${#urls[@]} -eq 0 ]; then
        echo "Error: No URLs found in $URL_FILE"
        echo "Add URLs (one per line) to the file and try again."
        exit 1
    fi
    
    set -- "${urls[@]}"  # Set positional parameters to the URLs from file
    echo "Found ${#urls[@]} URL(s) in file"
fi

# Extract current SITE_ID from local.js
cd "$SCRAPER_DIR" || exit 1

CURRENT_SITE_ID=$(grep -E "const SITE_ID = '[^']+'" local.js | sed -E "s/.*const SITE_ID = '([^']+)'.*/\1/")

if [ -z "$CURRENT_SITE_ID" ]; then
    echo "⚠️  Could not find SITE_ID in local.js"
    CURRENT_SITE_ID="<not found>"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              CURRENT SITE_ID CONFIGURATION                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Current SITE_ID: $CURRENT_SITE_ID"
echo ""
echo "Options:"
echo "  1. Press ENTER to use current SITE_ID"
echo "  2. Paste a new SITE_ID to change it"
echo ""
read -p "Enter new SITE_ID (or press ENTER to keep current): " NEW_SITE_ID

if [ -n "$NEW_SITE_ID" ]; then
    echo ""
    echo "🔄 Updating SITE_ID to: $NEW_SITE_ID"
    # Update SITE_ID in local.js using sed
    sed -i.bak "s/const SITE_ID = '[^']*'/const SITE_ID = '$NEW_SITE_ID'/" local.js
    echo "✅ SITE_ID updated!"
    CURRENT_SITE_ID="$NEW_SITE_ID"
else
    echo ""
    echo "✅ Using current SITE_ID: $CURRENT_SITE_ID"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Show existing sites in tmp/scrapes
if [ -d "tmp/scrapes" ]; then
    EXISTING_SITES=$(ls -1 tmp/scrapes 2>/dev/null | wc -l | xargs)
    if [ "$EXISTING_SITES" -gt 0 ]; then
        echo "📁 Found existing scrape data for $EXISTING_SITES site(s):"
        ls -1 tmp/scrapes | while read site; do
            echo "   • $site"
        done
        echo ""
    fi
fi

# Check if this specific site already has scrape data
SITE_SCRAPE_DIR="tmp/scrapes/$CURRENT_SITE_ID"
if [ -d "$SITE_SCRAPE_DIR" ]; then
    echo "🗑️  Found existing scrape data for this site: $CURRENT_SITE_ID"
    echo ""
    echo "Options:"
    echo "  1. Delete and start fresh"
    echo "  2. Keep existing and add to it (or overwrite duplicates)"
    echo "  3. Cancel (don't run scraper)"
    echo ""
    read -p "Choose [1/2/3]: " SCRAPE_CHOICE
    
    case "$SCRAPE_CHOICE" in
        1)
            echo "Deleting scrape data for $CURRENT_SITE_ID..."
            rm -rf "$SITE_SCRAPE_DIR"
            echo "✅ Cleaned up old scrapes for this site"
            ;;
        2)
            echo "⚠️  Keeping existing scrapes (will add new URLs or overwrite duplicates)"
            ;;
        3)
            echo "Cancelled. Not running scraper."
            exit 0
            ;;
        *)
            echo "Invalid choice. Cancelled."
            exit 1
            ;;
    esac
    echo ""
else
    echo "✅ No existing scrape data for this site"
    echo ""
fi

echo "Updating local.js with $# URL(s)..."

# Backup original local.js (if not already backed up from SITE_ID change)
if [ ! -f "local.js.bak" ]; then
    cp local.js local.js.bak
fi

# Use Node.js to safely update the file (handles all special characters)
node -e "
const fs = require('fs');
const urls = process.argv.slice(1);
const content = fs.readFileSync('local.js', 'utf8');

// Build the URL array
const urlArray = urls.map(url => \`    { url: '\${url}' }\`).join(',\\n');

// Replace the urlsData array
const newContent = content.replace(
  /const urlsData = \[[\s\S]*?\];/m,
  \`const urlsData = [\\n\${urlArray}\\n  ];\`
);

fs.writeFileSync('local.js', newContent);
" "$@"

if [ $? -eq 0 ]; then
    echo "✅ Updated local.js with URLs"
    echo ""
    
    # Patch abstract-handler.js to remove executablePath for local testing
    # This is the base class used by DefaultHandler and most other handlers
    echo "🔧 Patching abstract-handler.js for local testing..."
    
    # Backup the original file
    cp src/handlers/abstract-handler.js src/handlers/abstract-handler.js.backup
    
    # Remove the executablePath line from the isLocal options block
    node -e "
const fs = require('fs');
let content = fs.readFileSync('src/handlers/abstract-handler.js', 'utf8');

// Remove the executablePath line from the isLocal options block
// Pattern: executablePath: '/opt/homebrew/bin/chromium', (with possible whitespace)
content = content.replace(
  /(\s*)executablePath:\s*'\/opt\/homebrew\/bin\/chromium',?\s*\n/g,
  ''
);

fs.writeFileSync('src/handlers/abstract-handler.js', content);
console.log('✅ Removed executablePath line from abstract-handler.js - will use Puppeteer bundled Chromium');
"
    
    if [ $? -ne 0 ]; then
        echo "❌ Error patching abstract-handler.js"
        mv src/handlers/abstract-handler.js.backup src/handlers/abstract-handler.js
        exit 1
    fi
    echo ""
    
    echo "Running scraper..."
    echo "=================="
    
    # Run the scraper (tmp cleanup handled earlier based on user choice)
    node local.js
    
    echo ""
    echo "=================="
    echo "✅ Scraping complete!"
    echo ""
    echo "Results saved in:"
    find tmp -name "scrape.json" -type f | while read file; do
        echo "  📄 $file"
    done
    
    # Restore abstract-handler.js
    if [ -f "src/handlers/abstract-handler.js.backup" ]; then
        mv src/handlers/abstract-handler.js.backup src/handlers/abstract-handler.js
        echo ""
        echo "✅ Restored abstract-handler.js"
    fi
    
    # Handle SITE_ID changes and sync back to central repo
    if [ -n "$NEW_SITE_ID" ]; then
        echo ""
        echo "Note: SITE_ID was changed to: $NEW_SITE_ID"
        read -p "Save new SITE_ID to central repo (my-workspace-tools)? (Y/n): " KEEP_SITE_ID
        if [[ "$KEEP_SITE_ID" =~ ^[Nn] ]]; then
            echo "🔄 SITE_ID change discarded"
        else
            # Copy the SITE_ID change BACK to central repo
            # Extract just the SITE_ID from current local.js and update central repo
            echo "💾 Saving SITE_ID to central repo..."
            node -e "
const fs = require('fs');
const current = fs.readFileSync('local.js', 'utf8');
const central = fs.readFileSync('$SPACECAT_TOOLS_DIR/local.js', 'utf8');

// Extract SITE_ID from current
const siteIdMatch = current.match(/const SITE_ID = '[^']+'/);
if (siteIdMatch) {
  // Update central repo's SITE_ID
  const newCentral = central.replace(/const SITE_ID = '[^']+'/, siteIdMatch[0]);
  fs.writeFileSync('$SPACECAT_TOOLS_DIR/local.js', newCentral);
}
"
            echo "✅ Synced SITE_ID → my-workspace-tools/local.js"
            echo ""
            echo "💡 Don't forget to commit in my-workspace-tools if you want to share:"
            echo "   cd $SPACECAT_TOOLS_DIR"
            echo "   git add local.js"
            echo "   git commit -m 'Update scraper SITE_ID'"
        fi
    else
        echo ""
        echo "ℹ️  No SITE_ID changes to save"
    fi
    
    # Always restore original in scraper (will be synced from central next run)
    if [ -f "local.js.bak" ]; then
        mv local.js.bak local.js
        echo "✅ Restored original local.js"
    fi
else
    echo "❌ Error updating local.js"
    mv local.js.bak local.js
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✅ Scraping complete! 🎉"
echo ""
echo "📋 Next step: Run the audit worker"
echo ""
echo "Run this command to analyze the scraped data:"
echo "  ./run-audit-worker.sh"
echo ""
echo "Make sure to:"
echo "  - Select audit type: meta-tags (or other audit that uses scraper data)"
echo "  - Select: true (use local scraper data)"
echo "  - Use the same SITE_ID: $CURRENT_SITE_ID"
echo ""

