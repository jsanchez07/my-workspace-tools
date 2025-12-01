#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/spacecat-config.sh"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║          SPACECAT LOCAL TESTING TOOLS SETUP                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "This script will help you configure paths for local testing."
echo ""

# Check if config already exists
if [ -f "$CONFIG_FILE" ]; then
    echo "📋 Found existing configuration at:"
    echo "   $CONFIG_FILE"
    echo ""
    
    # Source and show current values
    source "$CONFIG_FILE"
    echo "Current configuration:"
    echo "  Scraper directory:      $SPACECAT_SCRAPER_DIR"
    echo "  Audit worker directory: $SPACECAT_AUDIT_WORKER_DIR"
    echo "  Tools directory:        $SPACECAT_TOOLS_DIR"
    echo ""
    
    read -p "Reconfigure? (y/N): " RECONFIGURE
    if [[ ! "$RECONFIGURE" =~ ^[Yy] ]]; then
        echo ""
        echo "✅ Keeping current configuration"
        echo ""
        echo "To manually edit, open: $CONFIG_FILE"
        exit 0
    fi
    echo ""
fi

echo "═══════════════════════════════════════════════════════════════"
echo ""

# Prompt for scraper directory
echo "1. SpaceCat Content Scraper Directory"
echo "   (Where is spacecat-content-scraper located?)"
echo ""

# Try to detect common locations
DETECTED_SCRAPER=""
COMMON_PATHS=(
    "$HOME/Documents/GitHub/SPACECAT/spacecat-content-scraper"
    "$HOME/projects/SPACECAT/spacecat-content-scraper"
    "$HOME/workspace/spacecat-content-scraper"
    "$HOME/spacecat-content-scraper"
)

for path in "${COMMON_PATHS[@]}"; do
    if [ -d "$path" ]; then
        DETECTED_SCRAPER="$path"
        echo "   ✅ Detected: $path"
        break
    fi
done

if [ -n "$DETECTED_SCRAPER" ]; then
    read -p "   Use detected path? (Y/n): " USE_DETECTED
    if [[ ! "$USE_DETECTED" =~ ^[Nn] ]]; then
        SCRAPER_DIR="$DETECTED_SCRAPER"
    else
        read -p "   Enter full path: " SCRAPER_DIR
    fi
else
    read -p "   Enter full path: " SCRAPER_DIR
fi

# Validate scraper directory
if [ ! -d "$SCRAPER_DIR" ]; then
    echo "   ⚠️  Warning: Directory does not exist: $SCRAPER_DIR"
    read -p "   Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy] ]]; then
        echo "   Cancelled."
        exit 1
    fi
elif [ ! -f "$SCRAPER_DIR/local.js" ]; then
    echo "   ⚠️  Warning: local.js not found in $SCRAPER_DIR"
    read -p "   Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy] ]]; then
        echo "   Cancelled."
        exit 1
    fi
else
    echo "   ✅ Valid scraper directory"
fi

echo ""

# Prompt for audit worker directory
echo "2. SpaceCat Audit Worker Directory"
echo "   (Where is spacecat-audit-worker located?)"
echo ""

# Try to detect audit worker
DETECTED_AUDIT=""
COMMON_PATHS=(
    "$HOME/Documents/GitHub/SPACECAT/spacecat-audit-worker"
    "$HOME/projects/SPACECAT/spacecat-audit-worker"
    "$HOME/workspace/spacecat-audit-worker"
    "$HOME/spacecat-audit-worker"
)

for path in "${COMMON_PATHS[@]}"; do
    if [ -d "$path" ]; then
        DETECTED_AUDIT="$path"
        echo "   ✅ Detected: $path"
        break
    fi
done

if [ -n "$DETECTED_AUDIT" ]; then
    read -p "   Use detected path? (Y/n): " USE_DETECTED
    if [[ ! "$USE_DETECTED" =~ ^[Nn] ]]; then
        AUDIT_WORKER_DIR="$DETECTED_AUDIT"
    else
        read -p "   Enter full path: " AUDIT_WORKER_DIR
    fi
else
    read -p "   Enter full path: " AUDIT_WORKER_DIR
fi

# Validate audit worker directory
if [ ! -d "$AUDIT_WORKER_DIR" ]; then
    echo "   ⚠️  Warning: Directory does not exist: $AUDIT_WORKER_DIR"
    read -p "   Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy] ]]; then
        echo "   Cancelled."
        exit 1
    fi
elif [ ! -f "$AUDIT_WORKER_DIR/src/index-local.js" ]; then
    echo "   ⚠️  Warning: src/index-local.js not found in $AUDIT_WORKER_DIR"
    read -p "   Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy] ]]; then
        echo "   Cancelled."
        exit 1
    fi
else
    echo "   ✅ Valid audit worker directory"
fi

echo ""

# Tools directory (current directory)
TOOLS_DIR="$SCRIPT_DIR"

echo "3. Tools Directory"
echo "   (Where these scripts are located)"
echo ""
echo "   Auto-detected: $TOOLS_DIR"
echo "   ✅ Using current directory"
echo ""

# Prompt for optional API key
echo "4. SpaceCat API Key (Optional)"
echo "   (Leave empty to be prompted each time)"
echo ""
read -p "   API Key [leave empty to skip]: " API_KEY
echo ""

# Generate config file
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📝 Writing configuration to:"
echo "   $CONFIG_FILE"
echo ""

cat > "$CONFIG_FILE" << EOF
#!/bin/bash
# SpaceCat Local Testing Configuration
# This file is auto-generated by setup-spacecat-tools.sh
# Edit this file or re-run setup to change paths

# Path to spacecat-content-scraper directory
export SPACECAT_SCRAPER_DIR="$SCRAPER_DIR"

# Path to spacecat-audit-worker directory
export SPACECAT_AUDIT_WORKER_DIR="$AUDIT_WORKER_DIR"

# Path to my-workspace-tools directory (where these scripts live)
export SPACECAT_TOOLS_DIR="$TOOLS_DIR"

# Path to scraper's tmp folder (used by audit worker's mock S3 client)
export SPACECAT_SCRAPER_TMP_DIR="\$SPACECAT_SCRAPER_DIR/tmp"

# Optional: Default SpaceCat API key (leave empty to prompt each time)
export SPACECAT_API_KEY="$API_KEY"

# ============================================================================
# You can manually edit the paths above or re-run: ./setup-spacecat-tools.sh
# ============================================================================
EOF

chmod +x "$CONFIG_FILE"

echo "✅ Configuration saved!"
echo ""

# Show summary
echo "📊 Configuration Summary:"
echo "─────────────────────────────────────────────────────────────"
echo "Scraper directory:      $SCRAPER_DIR"
echo "Audit worker directory: $AUDIT_WORKER_DIR"
echo "Tools directory:        $TOOLS_DIR"
if [ -n "$API_KEY" ]; then
    echo "API Key:                ***${API_KEY: -8}"
else
    echo "API Key:                (will prompt when needed)"
fi
echo "─────────────────────────────────────────────────────────────"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✅ Setup complete! 🎉"
echo ""
echo "Your scripts are now configured and ready to use:"
echo "  - get-top-pages.sh       # Fetch top pages from SpaceCat API"
echo "  - run-scraper.sh         # Scrape pages locally"
echo "  - sync-scrapes-to-s3.sh  # Upload scrapes to S3 (optional)"
echo "  - run-audit-worker.sh    # Run audit locally"
echo ""
echo "📝 Next steps:"
echo "  1. Review the configuration file if needed:"
echo "     code $CONFIG_FILE"
echo ""
echo "  2. Start testing:"
echo "     # First, load AWS credentials in your shell (e.g., via klam)"
echo "     ./get-top-pages.sh         # Get URLs from API"
echo "     ./run-scraper.sh           # Scrape the URLs"
echo "     ./sync-scrapes-to-s3.sh    # (Optional) Upload to S3 for production-like testing"
echo "     ./run-audit-worker.sh      # Run the audit"
echo ""

