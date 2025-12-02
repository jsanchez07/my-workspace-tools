#!/bin/bash

# Note: This script is compatible with bash 3.2+ (macOS default bash)

# Cleanup function to restore files if script exits early
cleanup_on_exit() {
    cd "$AUDIT_WORKER_DIR" 2>/dev/null || return
    
    # Restore index-local.js to original git-tracked version
    if [ -f "src/index-local.js.original" ]; then
        echo ""
        echo "🔄 Restoring index-local.js to git-tracked version (cleanup)..."
        mv src/index-local.js.original src/index-local.js
        echo "✅ index-local.js restored"
    fi
    
    # Restore step-audit.js if it was patched
    if [ -f "src/common/step-audit.js.backup" ]; then
        echo ""
        echo "🔄 Restoring step-audit.js (cleanup)..."
        mv src/common/step-audit.js.backup src/common/step-audit.js
        echo "✅ step-audit.js restored"
    fi
    
    # Clean up temporary files
    rm -f src/indexlocal.js 2>/dev/null
    rm -f template-local.yml 2>/dev/null
    rm -f env.json 2>/dev/null
    rm -rf scraper-data 2>/dev/null
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

# Source config helpers for last-run tracking
source "$SCRIPT_DIR/config-helpers.sh"

AUDIT_WORKER_DIR="$SPACECAT_AUDIT_WORKER_DIR"
INDEX_LOCAL_FILE="$AUDIT_WORKER_DIR/src/index-local.js"

# ============================================================================
# BACKUP: Save original git-tracked version BEFORE syncing
# ============================================================================
echo "💾 Backing up original index-local.js from audit worker repo..."
if [ -f "$INDEX_LOCAL_FILE" ]; then
    cp "$INDEX_LOCAL_FILE" "$INDEX_LOCAL_FILE.original"
    echo "✅ Saved backup of git-tracked version"
    echo ""
else
    echo "⚠️  Warning: index-local.js not found in audit worker"
    echo ""
fi

# ============================================================================
# SYNC: Copy master index-local.js from central repo to audit worker
# ============================================================================
echo "🔄 Syncing index-local.js from central repo..."
if [ -f "$SPACECAT_TOOLS_DIR/index-local.js" ]; then
    cp "$SPACECAT_TOOLS_DIR/index-local.js" "$INDEX_LOCAL_FILE"
    echo "✅ Synced latest index-local.js from my-workspace-tools"
    echo ""
else
    echo "⚠️  Warning: $SPACECAT_TOOLS_DIR/index-local.js not found"
    echo "   Using existing file in audit worker"
    echo ""
fi

# Read last run values
LAST_AUDIT_TYPE=$(read_config "audit.lastAuditType")
LAST_SITE_ID=$(read_config "audit.lastSiteId")
LAST_USE_LOCAL=$(read_config "audit.lastUseLocalData")

if [ ! -d "$AUDIT_WORKER_DIR" ]; then
    echo "Error: Audit worker directory not found at $AUDIT_WORKER_DIR"
    exit 1
fi

if [ ! -f "$INDEX_LOCAL_FILE" ]; then
    echo "Error: index-local.js not found at $INDEX_LOCAL_FILE"
    exit 1
fi

# Extract current values from index-local.js
cd "$AUDIT_WORKER_DIR" || exit 1

# Check AWS credentials in current shell
if [ -n "$AWS_PROFILE" ] || [ -n "$AWS_ACCESS_KEY_ID" ]; then
    echo "✅ AWS credentials already loaded in your terminal:"
    if [ -n "$AWS_PROFILE" ]; then
        echo "   AWS_PROFILE: $AWS_PROFILE"
    fi
    if [ -n "$AWS_REGION" ]; then
        echo "   AWS_REGION: $AWS_REGION"
    fi
    if [ -n "$DYNAMO_TABLE_NAME_DATA" ]; then
        echo "   Table: $DYNAMO_TABLE_NAME_DATA"
    fi
    echo ""
elif [ -f "env.sh" ]; then
    echo "📋 AWS credentials not detected in terminal"
    echo "   Found env.sh file - you can source it"
    echo ""
    echo "💡 TIP: For persistent credentials, source env.sh in your terminal:"
    echo "   cd $AUDIT_WORKER_DIR && source env.sh"
    echo ""
    echo "   Then credentials will persist for your entire terminal session!"
    echo ""
    read -p "Source env.sh now (only for this script run)? (Y/n): " SOURCE_ENV
    if [[ ! "$SOURCE_ENV" =~ ^[Nn] ]]; then
        echo "Loading environment variables from env.sh..."
        source env.sh
        echo "✅ Environment variables loaded (for this script run only)"
        
        # Show key variables
        if [ -n "$AWS_PROFILE" ]; then
            echo "   AWS_PROFILE: $AWS_PROFILE"
        fi
        if [ -n "$AWS_REGION" ]; then
            echo "   AWS_REGION: $AWS_REGION"
        fi
        if [ -n "$DYNAMO_TABLE_NAME_DATA" ]; then
            echo "   Table: $DYNAMO_TABLE_NAME_DATA"
        fi
    else
        echo "⚠️  Skipped loading env.sh - you'll need AWS credentials another way"
    fi
    echo ""
else
    echo "⚠️  No env.sh found - load AWS credentials (e.g., via klam) first!"
    echo ""
fi

# Check if AWS credentials are available
if [ -z "$AWS_PROFILE" ] && [ -z "$AWS_ACCESS_KEY_ID" ]; then
    echo "⚠️  WARNING: No AWS credentials detected!"
    echo ""
    echo "The audit worker needs AWS credentials to access DynamoDB,"
    echo "even when using local scraper data."
    echo ""
    echo "Options:"
    echo "  1. Run: aws sso login --profile <your-profile>"
    echo "  2. Export AWS_PROFILE=<your-profile>"
    echo "  3. Source env.sh if you have one"
    echo ""
    read -p "Continue anyway? (y/N): " CONTINUE_NO_CREDS
    if [[ ! "$CONTINUE_NO_CREDS" =~ ^[Yy] ]]; then
        echo "Cancelled. Please set up AWS credentials first."
        exit 0
    fi
    echo ""
fi

# Read current configuration from index-local.js
CURRENT_USE_LOCAL=$(grep -E "const USE_LOCAL_SCRAPER_DATA" src/index-local.js | head -1 | grep -o "true\|false" || echo "false")
CURRENT_SITE_ID=$(grep -E "siteId: '[^']+'" src/index-local.js | head -1 | sed -E "s/.*siteId: '([^']+)'.*/\1/")
CURRENT_AUDIT_TYPE=$(grep -E "type: '[^']+'" src/index-local.js | head -1 | sed -E "s/.*type: '([^']+)'.*/\1/")

if [ -z "$CURRENT_SITE_ID" ]; then
    echo "⚠️  Could not find siteId in index-local.js"
    CURRENT_SITE_ID="<not found>"
fi

if [ -z "$CURRENT_AUDIT_TYPE" ]; then
    echo "⚠️  Could not find type in index-local.js"
    CURRENT_AUDIT_TYPE="<not found>"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           AUDIT WORKER CONFIGURATION                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# STEP 1: Prompt for Audit Type FIRST
echo "Supported audits:"
echo "  • broken-internal-links   • canonical          • hreflang"
echo "  • meta-tags              • redirect-chains    • sitemap"
echo "  • structured-data        • missing-structured-data"
echo ""
if [ -n "$LAST_AUDIT_TYPE" ]; then
    read -p "Audit type [last: $LAST_AUDIT_TYPE]: " NEW_AUDIT_TYPE
    if [ -z "$NEW_AUDIT_TYPE" ]; then
        NEW_AUDIT_TYPE="$LAST_AUDIT_TYPE"
    fi
else
    read -p "Audit type [current: $CURRENT_AUDIT_TYPE]: " NEW_AUDIT_TYPE
    if [ -z "$NEW_AUDIT_TYPE" ]; then
        NEW_AUDIT_TYPE="$CURRENT_AUDIT_TYPE"
    fi
fi

# Check if audit requires network access when using local scraper data
if [ "$NEW_USE_LOCAL" == "true" ]; then
    case "$NEW_AUDIT_TYPE" in
        "hreflang"|"canonical"|"404"|"sitemap"|"accessibility"|"lhs-mobile"|"lhs-desktop"|"prerender"|"preflight")
            echo ""
            echo "⚠️  WARNING: The '$NEW_AUDIT_TYPE' audit requires network access to fetch live URLs."
            echo "   This audit may fail or encounter errors (like CSS parsing issues) when running locally."
            echo ""
            echo "   Audits that work fully offline with local scraper data:"
            echo "     • meta-tags ✅"
            echo "     • product-metatags"
            echo "     • structured-data"
            echo ""
            read -p "Continue anyway? (y/n): " CONTINUE_NETWORK
            if [ "$CONTINUE_NETWORK" != "y" ]; then
                echo "❌ Aborted."
                exit 0
            fi
            ;;
    esac
fi

# Dynamically detect if audit is multi-step by reading handler.js
echo ""
echo "🔍 Analyzing audit type: $NEW_AUDIT_TYPE..."

# Convert audit type to directory name (e.g., "lhs-mobile" -> "lhs", "meta-tags" -> "metatags")
AUDIT_DIR="$NEW_AUDIT_TYPE"
# Handle special cases
case "$NEW_AUDIT_TYPE" in
    "lhs-mobile"|"lhs-desktop")
        AUDIT_DIR="lhs"
        ;;
    "meta-tags")
        AUDIT_DIR="metatags"
        ;;
    "product-metatags")
        AUDIT_DIR="product-metatags"
        ;;
    "structured-data")
        AUDIT_DIR="structured-data"
        ;;
    "broken-backlinks")
        AUDIT_DIR="backlinks"
        ;;
    "broken-internal-links")
        AUDIT_DIR="internal-links"
        ;;
esac

# STEP 2: Ask audit-specific question about local data
echo ""
if [[ "$NEW_AUDIT_TYPE" == "canonical" ]] || [[ "$NEW_AUDIT_TYPE" == "hreflang" ]]; then
    # For canonical/hreflang: Ask about using local URL list
    echo "ℹ️  The '$NEW_AUDIT_TYPE' audit:"
    echo "   • Reads URL list from: urls-to-scrape.txt"
    echo "   • Fetches pages LIVE from the website (not from scraper data)"
    echo ""
    echo "💡 Make sure you've run: ./get-top-pages.sh"
    echo ""
    
    read -p "Use local URL list from urls-to-scrape.txt? (Y/n): " USE_LOCAL_URLS
    if [[ "$USE_LOCAL_URLS" =~ ^[Nn] ]]; then
        # User wants to fetch from DynamoDB instead
        NEW_USE_LOCAL="false"
        echo "   → Will fetch URLs from DynamoDB (production data)"
    else
        # Default to using local URLs for canonical/hreflang
        NEW_USE_LOCAL="false"  # Not using scraper data
        USE_LOCAL_URLS="Y"  # Explicitly set for later reference
        echo "   → Will use local URLs from urls-to-scrape.txt"
    fi
else
    # For other audits: Ask about using local scraper data
    USE_LOCAL_URLS=""  # Not applicable for non-canonical/hreflang audits
    
    echo "ℹ️  The '$NEW_AUDIT_TYPE' audit can use:"
    echo "   • Local scraper data (from your local scraper run)"
    echo "   • Or fetch from S3 (production scraper results)"
    echo ""
    
    read -p "Use local scraper data? (true/false) [current: $CURRENT_USE_LOCAL]: " NEW_USE_LOCAL
    if [ -z "$NEW_USE_LOCAL" ]; then
        NEW_USE_LOCAL="$CURRENT_USE_LOCAL"
    fi
    
    # Validate boolean input
    if [[ "$NEW_USE_LOCAL" != "true" && "$NEW_USE_LOCAL" != "false" ]]; then
        echo "⚠️  Invalid value. Must be 'true' or 'false'. Using current value: $CURRENT_USE_LOCAL"
        NEW_USE_LOCAL="$CURRENT_USE_LOCAL"
    fi
    
    if [[ "$NEW_USE_LOCAL" == "true" ]]; then
        echo "   → Will use local scraper data"
    else
        echo "   → Will fetch from S3"
    fi
fi

HANDLER_FILE="$SPACECAT_AUDIT_WORKER_DIR/src/$AUDIT_DIR/handler.js"

if [ ! -f "$HANDLER_FILE" ]; then
    echo "⚠️  Warning: Could not find handler file at $HANDLER_FILE"
    echo "   Assuming single-step audit"
    IS_MULTI_STEP=false
    FINAL_STEP_NAME=""
else
    # Use Node.js to parse the handler file and detect steps
    AUDIT_INFO=$(node -e "
const fs = require('fs');
try {
  const content = fs.readFileSync('$HANDLER_FILE', 'utf8');
  
  // Find all .addStep calls - handle both same-line and multi-line formats
  // Pattern 1: .addStep('step-name', ...)
  // Pattern 2: .addStep(\n    'step-name', ...)
  const stepMatches = content.match(/\.addStep\(\s*'([^']+)'/g);
  
  if (!stepMatches || stepMatches.length === 0) {
    // No addStep calls - single-step audit (uses .withRunner)
    console.log('single|');
  } else {
    // Multi-step audit - extract step names
    const stepNames = stepMatches.map(match => match.match(/\.addStep\(\s*'([^']+)'/)[1]);
    const lastStep = stepNames[stepNames.length - 1];
    console.log('multi|' + lastStep + '|' + stepNames.join(','));
  }
} catch (error) {
  console.log('error|' + error.message);
}
")
    
    # Parse the result
    AUDIT_TYPE_INFO=$(echo "$AUDIT_INFO" | cut -d'|' -f1)
    
    if [ "$AUDIT_TYPE_INFO" = "error" ]; then
        ERROR_MSG=$(echo "$AUDIT_INFO" | cut -d'|' -f2)
        echo "⚠️  Error parsing handler: $ERROR_MSG"
        echo "   Assuming single-step audit"
        IS_MULTI_STEP=false
        FINAL_STEP_NAME=""
    elif [ "$AUDIT_TYPE_INFO" = "multi" ]; then
        IS_MULTI_STEP=true
        FINAL_STEP_NAME=$(echo "$AUDIT_INFO" | cut -d'|' -f2)
        ALL_STEPS=$(echo "$AUDIT_INFO" | cut -d'|' -f3)
        echo "   ✅ Multi-step audit detected"
        echo "   📋 Steps: $ALL_STEPS"
        echo "   🎯 Final step: $FINAL_STEP_NAME"
    else
        IS_MULTI_STEP=false
        FINAL_STEP_NAME=""
        echo "   ✅ Single-step audit"
    fi
fi

echo ""

# Prompt for Site ID (always show scraper's SITE_ID as helpful hint)
echo ""

# Try to get scraper's SITE_ID for reference
SCRAPER_LOCAL_JS="$SPACECAT_SCRAPER_DIR/local.js"
SCRAPER_SITE_ID=""
if [ -f "$SCRAPER_LOCAL_JS" ]; then
    SCRAPER_SITE_ID=$(grep -E "const SITE_ID = '[^']+'" "$SCRAPER_LOCAL_JS" | sed -E "s/.*const SITE_ID = '([^']+)'.*/\1/")
fi

if [ "$NEW_USE_LOCAL" = "true" ]; then
    # Using local data - MUST match scraper's SITE_ID
    if [ -n "$SCRAPER_SITE_ID" ]; then
        echo "💡 Scraper's SITE_ID: $SCRAPER_SITE_ID"
        echo "   (Must match when using local scraper data!)"
        echo ""
        if [ -n "$LAST_SITE_ID" ]; then
            read -p "Site ID [last: $LAST_SITE_ID]: " NEW_SITE_ID
            if [ -z "$NEW_SITE_ID" ]; then
                NEW_SITE_ID="$LAST_SITE_ID"
            fi
        else
            read -p "Site ID [press ENTER to use scraper's: $SCRAPER_SITE_ID]: " NEW_SITE_ID
            if [ -z "$NEW_SITE_ID" ]; then
                NEW_SITE_ID="$SCRAPER_SITE_ID"
                echo "   → Using scraper's SITE_ID"
            fi
        fi
    else
        echo "⚠️  Could not detect scraper's SITE_ID from local.js"
        if [ -n "$LAST_SITE_ID" ]; then
            read -p "Site ID [last: $LAST_SITE_ID]: " NEW_SITE_ID
            if [ -z "$NEW_SITE_ID" ]; then
                NEW_SITE_ID="$LAST_SITE_ID"
            fi
        else
            read -p "Site ID [current: $CURRENT_SITE_ID]: " NEW_SITE_ID
            if [ -z "$NEW_SITE_ID" ]; then
                NEW_SITE_ID="$CURRENT_SITE_ID"
            fi
        fi
    fi
else
    # Using real S3 - show scraper's SITE_ID as reference but doesn't need to match
    echo "ℹ️  Using real S3 - Site ID doesn't need to match scraper"
    if [ -n "$SCRAPER_SITE_ID" ]; then
        echo "   (But FYI, scraper currently has: $SCRAPER_SITE_ID)"
    fi
    echo ""
    if [ -n "$LAST_SITE_ID" ]; then
        read -p "Site ID [last: $LAST_SITE_ID]: " NEW_SITE_ID
        if [ -z "$NEW_SITE_ID" ]; then
            NEW_SITE_ID="$LAST_SITE_ID"
        fi
    else
        read -p "Site ID [current: $CURRENT_SITE_ID]: " NEW_SITE_ID
        if [ -z "$NEW_SITE_ID" ]; then
            NEW_SITE_ID="$CURRENT_SITE_ID"
        fi
    fi
fi

# Validate UUID format (8-4-4-4-12 pattern)
UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
if [[ ! "$NEW_SITE_ID" =~ $UUID_PATTERN ]]; then
    echo ""
    echo "⚠️  WARNING: Site ID doesn't match UUID format (8-4-4-4-12)"
    echo "   Provided: $NEW_SITE_ID (length: ${#NEW_SITE_ID})"
    echo "   Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    echo ""
    read -p "Continue anyway? (y/N): " CONTINUE_BAD_UUID
    if [[ ! "$CONTINUE_BAD_UUID" =~ ^[Yy] ]]; then
        echo "Cancelled. Please check the Site ID and try again."
        exit 0
    fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Will run audit with:"
echo "  Audit Type: $NEW_AUDIT_TYPE"
echo "  Site ID: $NEW_SITE_ID"
if [[ "$NEW_AUDIT_TYPE" == "canonical" ]] || [[ "$NEW_AUDIT_TYPE" == "hreflang" ]]; then
    if [[ ! "$USE_LOCAL_URLS" =~ ^[Nn] ]]; then
        echo "  URL Source: Local (urls-to-scrape.txt)"
    else
        echo "  URL Source: DynamoDB (production)"
    fi
else
    echo "  Scraper Data: $([[ "$NEW_USE_LOCAL" == "true" ]] && echo "Local" || echo "S3")"
fi

# Initialize SKIP_TO_FINAL (used in Node.js script later)
SKIP_TO_FINAL=false

# Show multi-step info and handle step selection for broken-internal-links
if [ "$NEW_AUDIT_TYPE" = "broken-internal-links" ] && [ "$IS_MULTI_STEP" = true ]; then
    echo ""
    echo "  🔧 broken-internal-links requires step-by-step execution:"
    echo "     Step 1: Fetch RUM data (broken link list)"
    echo "     Step 2: Run scraper manually with those URLs"
    echo "     Step 3: Generate AI suggestions from scraped pages"
    echo ""
    echo "  Which step do you want to run?"
    echo "    1 - Run Step 1 (fetch RUM data for broken links)"
    echo "    3 - Run Step 3 (generate suggestions from scraped data)"
    echo ""
    read -p "  Choose step [1/3]: " STEP_CHOICE
    
    if [ "$STEP_CHOICE" = "1" ]; then
        echo "  → Will run Step 1 only (fetch RUM data)"
        SKIP_TO_FINAL=false
        
        # Prompt for RUM domain key (required for Step 1)
        echo ""
        echo "  🔑 Step 1 requires a RUM domain key to access RUM API"
        echo "     Get it from: https://aemcs-workspace.adobe.com/customer/generate-rum-domain-key"
        echo ""
        read -p "  Enter RUM domain key: " RUM_DOMAIN_KEY
        
        if [ -z "$RUM_DOMAIN_KEY" ]; then
            echo ""
            echo "  ⚠️  RUM domain key is required for Step 1. Cannot proceed without it."
            exit 1
        fi
        
        # Export as environment variable for the audit to use
        export RUM_DOMAIN_KEY="$RUM_DOMAIN_KEY"
        echo "  ✅ RUM domain key set"
    elif [ "$STEP_CHOICE" = "3" ]; then
        echo "  → Will skip to Step 3 (assumes you already ran scraper)"
        SKIP_TO_FINAL=true
    else
        echo "  ⚠️  Invalid choice. Defaulting to Step 1."
        SKIP_TO_FINAL=false
    fi
elif [ "$IS_MULTI_STEP" = true ]; then
    # For ALL multi-step audits in local testing, skip to final step
    # (Running from beginning requires SQS queues which don't exist locally)
    echo ""
    echo "  🔧 Multi-step audit detected!"
    echo "  ↳ Will skip to final step: '$FINAL_STEP_NAME'"
    if [ "$NEW_USE_LOCAL" = "true" ]; then
        echo "  ↳ Using local scraper data"
    else
        echo "  ↳ Using S3 scraper data (assumes scraper already ran in AWS)"
    fi
    SKIP_TO_FINAL=true
fi

echo ""
read -p "Continue? (Y/n): " CONFIRM
if [[ "$CONFIRM" =~ ^[Nn] ]]; then
    echo "Cancelled."
    exit 0
fi

# Update index-local.js with run-specific settings
echo ""
echo "📝 Updating index-local.js with your run settings..."

# Update the file using Node.js for safe string replacement
node -e "
const fs = require('fs');
let content = fs.readFileSync('src/index-local.js', 'utf8');

// Update USE_LOCAL_SCRAPER_DATA constant
const useLocalValue = '${NEW_USE_LOCAL}' === 'true';
content = content.replace(
  /const USE_LOCAL_SCRAPER_DATA = (true|false);/,
  \`const USE_LOCAL_SCRAPER_DATA = \${useLocalValue};\`
);

// Update audit type (first occurrence in messageBody)
// Match with flexible whitespace around the comment
content = content.replace(
  /type: '[^']+',\s*\/\/\s*<<--.*$/m,
  \"type: '${NEW_AUDIT_TYPE}', // <<-- name of the audit\"
);

// Update siteId (first occurrence in messageBody)
// Match with or without a comment after
content = content.replace(
  /siteId: '[^']+',(\s*\/\/.*)?$/m,
  \"siteId: '${NEW_SITE_ID}',\"
);

// Handle auditContext for multi-step audits
const isMultiStep = ${IS_MULTI_STEP};
const skipToFinal = ${SKIP_TO_FINAL};
const finalStep = '${FINAL_STEP_NAME}';

if (isMultiStep && skipToFinal && finalStep) {
  // Skip to final step - ensure auditContext is set with the final step name
  // Use [\s\S]*? to match any character including newlines (non-greedy)
  const auditContextPattern = /auditContext:\s*\{[\s\S]*?next:\s*'([^']+)'[\s\S]*?\},/;
  const match = content.match(auditContextPattern);
  
  if (match) {
    // auditContext exists - just update the 'next' value
    content = content.replace(
      /(auditContext:\s*\{[\s\S]*?next:\s*')([^']+)'/,
      \"\$1\" + finalStep + \"'\"
    );
    console.log('✅ Updated auditContext.next to: ' + finalStep);
  } else {
    // auditContext is missing or commented out - uncomment or add it
    // Look for commented auditContext first
    if (/\/\/\s*auditContext:\s*\{/m.test(content)) {
      // Uncomment it
      content = content.replace(
        /\/\/(\s*auditContext:\s*\{[\\s\\S]*?\n\s*\/\/\s*\},)/m,
        \"\$1\"
      );
      // Then update the next field
      content = content.replace(
        /(auditContext:\s*\{[\s\S]*?next:\s*')([^']+)'/,
        \"\$1\" + finalStep + \"'\"
      );
      console.log('✅ Uncommented and updated auditContext.next to: ' + finalStep);
    } else {
      console.log('⚠️  Could not find auditContext in index-local.js');
      console.log('   The file should already have mock audit context configured');
    }
  }
} else if (isMultiStep && !skipToFinal) {
  // Start from beginning - comment out auditContext so audit runs all steps
  if (/^\s*auditContext:\s*\{/m.test(content) && !/^\s*\/\/\s*auditContext/m.test(content)) {
    // Find the auditContext block and comment out EVERY line
    const lines = content.split('\n');
    let inAuditContext = false;
    let commentedLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (/^\s*auditContext:\s*\{/.test(line)) {
        // Start of auditContext block
        inAuditContext = true;
        commentedLines.push(line.replace(/^(\s*)/, '$1// '));
      } else if (inAuditContext && /^\s*\},/.test(line)) {
        // End of auditContext block
        commentedLines.push(line.replace(/^(\s*)/, '$1// '));
        inAuditContext = false;
      } else if (inAuditContext) {
        // Inside auditContext block
        commentedLines.push(line.replace(/^(\s*)/, '$1// '));
      } else {
        // Outside auditContext block
        commentedLines.push(line);
      }
    }
    
    content = commentedLines.join('\n');
    console.log('✅ Commented out auditContext (will run from Step 1)');
  }
} else if (!isMultiStep) {
  // For single-step audits, comment out auditContext if it exists
  if (/^\s*auditContext:\s*\{/m.test(content) && !/^\s*\/\/\s*auditContext/m.test(content)) {
    // Find the auditContext block and comment out EVERY line
    const lines = content.split('\n');
    let inAuditContext = false;
    let commentedLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (/^\s*auditContext:\s*\{/.test(line)) {
        // Start of auditContext block
        inAuditContext = true;
        commentedLines.push(line.replace(/^(\s*)/, '$1// '));
      } else if (inAuditContext && /^\s*\},/.test(line)) {
        // End of auditContext block
        commentedLines.push(line.replace(/^(\s*)/, '$1// '));
        inAuditContext = false;
      } else if (inAuditContext) {
        // Inside auditContext block
        commentedLines.push(line.replace(/^(\s*)/, '$1// '));
      } else {
        // Outside auditContext block
        commentedLines.push(line);
      }
    }
    
    content = commentedLines.join('\n');
    console.log('✅ Commented out auditContext (single-step audit)');
  }
}

fs.writeFileSync('src/index-local.js', content);
"

if [ $? -ne 0 ]; then
    echo "❌ Error updating index-local.js"
    mv src/index-local.js.original src/index-local.js
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Apply patches to bypass audit enablement check (for all audits in local testing)
echo "🔧 Patching step-audit.js to bypass audit enablement check..."

# Backup the original file
cp src/common/step-audit.js src/common/step-audit.js.backup

# Apply the bypass patch
node -e "
const fs = require('fs');
let content = fs.readFileSync('src/common/step-audit.js', 'utf8');

// Bypass the isAuditEnabledForSite check for local testing
// Process line by line to properly comment out the entire if block
const lines = content.split('\\n');
let inEnabledCheck = false;
let braceDepth = 0;
let patched = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Start of the isAuditEnabledForSite check
  if (!inEnabledCheck && line.includes('isAuditEnabledForSite(type, site, context)')) {
    lines[i] = line.replace(
      /if \(\!\(await isAuditEnabledForSite\(type, site, context\)\)\) \{/,
      '// LOCAL TESTING: Bypass audit enablement check\\n      if (false) { // Disabled: isAuditEnabledForSite check'
    );
    inEnabledCheck = true;
    braceDepth = 1;
    patched = true;
    continue;
  }
  
  // Track braces to find the end of the if block
  if (inEnabledCheck) {
    // Count opening and closing braces
    for (const char of line) {
      if (char === '{') braceDepth++;
      if (char === '}') braceDepth--;
    }
    
    // End of the if block
    if (braceDepth === 0) {
      inEnabledCheck = false;
      // Add our bypass log after the if block
      lines[i] = lines[i] + '\\n      log.info(\\'[LOCAL TEST MODE] Bypassing audit enablement check\\');';
    }
  }
}

if (patched) {
  content = lines.join('\\n');
  fs.writeFileSync('src/common/step-audit.js', content);
  console.log('✅ Bypassed isAuditEnabledForSite check for local testing');
} else {
  console.log('⚠️  Could not find isAuditEnabledForSite check pattern');
}
"

if [ $? -ne 0 ]; then
    echo "❌ Error patching step-audit.js"
    mv src/common/step-audit.js.backup src/common/step-audit.js 2>/dev/null
    exit 1
fi

echo ""

# Apply additional step-audit.js patches for multi-step audits (only when skipping to final step)
if [ "$IS_MULTI_STEP" = true ] && [ "$SKIP_TO_FINAL" = true ]; then
    echo "🔧 Applying additional patches to step-audit.js for multi-step final step..."
    
    # Note: File is already backed up above, no need to backup again
    # Apply patches using Node.js for robust pattern matching
    node -e "
const fs = require('fs');
let content = fs.readFileSync('src/common/step-audit.js', 'utf8');

// ============================================================================
// PATCH 1: Add mock audit ID detection around loadExistingAudit call
// ============================================================================
// Find the pattern: if (hasNext) { ... stepContext.audit = await loadExistingAudit(...) }
const loadAuditPattern = /(\/\/ For subsequent steps, load existing audit\s+if \(hasNext\) \{\s+)(stepContext\.audit = await loadExistingAudit\(auditContext\.auditId, context\);)/s;

if (loadAuditPattern.test(content)) {
  content = content.replace(
    loadAuditPattern,
    \`\$1// LOCAL TESTING: Check if we're using a mock audit ID (all zeros UUID)
        // This allows local testing without needing a real audit in the database
        const isMockAuditId = auditContext.auditId === '00000000-0000-0000-0000-000000000000';
        
        if (isMockAuditId) {
          log.info('[LOCAL TEST MODE] Using mock audit object');
          // Create a minimal mock audit object with the required methods
          stepContext.audit = {
            getId: () => auditContext.auditId,
            getAuditType: () => type,
            getFullAuditRef: () => \\\`\\\${type}:\\\${auditContext.auditId}\\\`,
            getAuditedAt: () => new Date().toISOString(),
            getSiteId: () => siteId,
            // Add other methods as needed
          };
        } else {
          \$2
        }\`
  );
  console.log('✅ Patch 1: Added mock audit ID detection');
} else {
  console.log('⚠️  Patch 1: Pattern not found - step-audit.js may have changed');
  console.log('   Audit will try to use real database lookups');
}

// ============================================================================
// PATCH 2: Add mock scrape job ID detection around getScrapeResultPaths call
// ============================================================================
// Find the pattern: if (hasScrapeJobId) { ... const scrapeClient = ... getScrapeResultPaths(...) }
const getScrapePathsPattern = /(\/\/ If there are scrape results, load the paths\s+if \(hasScrapeJobId\) \{\s+)(const scrapeClient = ScrapeClient\.createFrom\(context\);\s+stepContext\.scrapeResultPaths = await scrapeClient\s+\.getScrapeResultPaths\(auditContext\.scrapeJobId\);)/s;

if (getScrapePathsPattern.test(content)) {
  content = content.replace(
    getScrapePathsPattern,
    \`\$1// LOCAL TESTING: Check if we're using a mock scrape job ID (all zeros UUID)
        const isMockScrapeJobId = auditContext.scrapeJobId === '00000000-0000-0000-0000-000000000000';
        
        if (isMockScrapeJobId && context.scrapeResultPaths) {
          log.info('[LOCAL TEST MODE] Using pre-loaded scrape result paths from context');
          stepContext.scrapeResultPaths = context.scrapeResultPaths;
        } else {
          \$2
        }\`
  );
  console.log('✅ Patch 2: Added mock scrape job ID detection');
} else {
  console.log('⚠️  Patch 2: Pattern not found - step-audit.js may have changed');
  console.log('   Audit will try to use real ScrapeClient');
}

fs.writeFileSync('src/common/step-audit.js', content);
console.log('');
console.log('✅ step-audit.js temporarily patched for local testing');
console.log('   (Will be restored after audit run)');
"
    
    if [ $? -ne 0 ]; then
        echo "❌ Error patching step-audit.js"
        mv src/common/step-audit.js.backup src/common/step-audit.js 2>/dev/null
        exit 1
    fi
    echo ""
else
    echo "ℹ️  Single-step audit - no patches needed for step-audit.js"
    echo ""
fi

# ═══════════════════════════════════════════════════════════════
# PATCH audit-utils.js to bypass audit enablement check
# ═══════════════════════════════════════════════════════════════
echo "🔧 Patching audit-utils.js to bypass audit enablement check..."

AUDIT_UTILS_FILE="$AUDIT_WORKER_DIR/src/common/audit-utils.js"

if [ ! -f "$AUDIT_UTILS_FILE" ]; then
    echo "⚠️  WARNING: audit-utils.js not found, skipping patch"
else
    # Backup the file
    cp "$AUDIT_UTILS_FILE" "$AUDIT_UTILS_FILE.backup"
    
    # Patch the isAuditEnabledForSite function to always return true for local testing
    node -e "
const fs = require('fs');
let content = fs.readFileSync('$AUDIT_UTILS_FILE', 'utf8');

// Find and replace the isAuditEnabledForSite function to return true early
const pattern = /(export async function isAuditEnabledForSite\([^)]+\) \{)/;

if (pattern.test(content)) {
  content = content.replace(
    pattern,
    '\$1' + String.fromCharCode(10) +
    '  // LOCAL TESTING: Always return true to bypass audit enablement check' + String.fromCharCode(10) +
    '  console.log(\"[LOCAL TEST MODE] Bypassing audit enablement check\");' + String.fromCharCode(10) +
    '  return true;' + String.fromCharCode(10) +
    '  ' + String.fromCharCode(10) +
    '  // eslint-disable-next-line no-unreachable' + String.fromCharCode(10)
  );
  fs.writeFileSync('$AUDIT_UTILS_FILE', content);
  console.log('✅ Patched isAuditEnabledForSite to always return true');
} else {
  console.log('⚠️  Pattern not found - audit-utils.js may have changed');
  console.log('   Audit enablement check may fail');
}
"
    
    if [ $? -ne 0 ]; then
        echo "❌ Error patching audit-utils.js"
        mv "$AUDIT_UTILS_FILE.backup" "$AUDIT_UTILS_FILE" 2>/dev/null
        exit 1
    fi
    echo ""
fi

# Clean up old output.txt
if [ -f "output.txt" ]; then
    echo "🗑️  Cleaning up old output.txt..."
    rm output.txt
    echo "✅ Removed old output file"
    echo ""
fi

# Clean SAM build cache to ensure fresh build
if [ -d ".aws-sam" ]; then
    echo "🗑️  Cleaning SAM build cache..."
    rm -rf .aws-sam
    echo "✅ Removed old SAM build"
    echo ""
fi

# Copy index-local.js to indexlocal.js (hyphen-free) for SAM
echo "📋 Creating hyphen-free copy for SAM..."
cp src/index-local.js src/indexlocal.js
echo "✅ Created src/indexlocal.js"
echo ""

# Create template-local.yml dynamically from template.yml
echo "📋 Creating template-local.yml with hyphen-free handler..."
sed 's|Handler: src/index-local\.main|Handler: src/indexlocal.main|' template.yml > template-local.yml
echo "✅ Created template-local.yml"
echo ""

echo "🔨 Building audit worker (fresh build)..."
echo "=================="
sam build --template template-local.yml

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Build failed!"
    mv src/index-local.js.original src/index-local.js
    exit 1
fi

echo ""
echo "📂 Setting up scraper data..."
# Copy scraper data into the BUILD directory so Docker can access it
BUILD_DIR="$AUDIT_WORKER_DIR/.aws-sam/build/SpacecatAuditWorkerFunction"
SCRAPER_SOURCE="$SPACECAT_SCRAPER_DIR/tmp/scrapes"
SCRAPER_DEST="$BUILD_DIR/scraper-data"

if [ -d "$SCRAPER_SOURCE" ]; then
    echo "   Copying scraper data from: $SCRAPER_SOURCE"
    echo "   Copying to BUILD directory: $SCRAPER_DEST"
    rm -rf "$SCRAPER_DEST"
    cp -r "$SCRAPER_SOURCE" "$SCRAPER_DEST"
    echo "   ✅ Scraper data ready in build directory"
else
    echo "   ⚠️  WARNING: No scraper data found at $SCRAPER_SOURCE"
    echo "   The audit will run but may fail if it needs scraper data"
fi

echo ""
echo "📝 Creating env.json for SAM..."

# Determine if we should use local top pages based on audit type and user choice
USE_LOCAL_TOP_PAGES_VALUE="false"
TOP_PAGES_FILE_VALUE=""

if [[ "$NEW_AUDIT_TYPE" == "canonical" ]] || [[ "$NEW_AUDIT_TYPE" == "hreflang" ]]; then
    # For canonical/hreflang, check if user chose to use local URLs
    if [[ ! "$USE_LOCAL_URLS" =~ ^[Nn] ]]; then
        USE_LOCAL_TOP_PAGES_VALUE="true"
        TOP_PAGES_FILE_VALUE="$SCRIPT_DIR/urls-to-scrape.txt"
    fi
fi

cat > "$AUDIT_WORKER_DIR/env.json" <<EOF
{
  "SpacecatAuditWorkerFunction": {
    "AWS_ACCESS_KEY_ID": "$AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY": "$AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN": "$AWS_SESSION_TOKEN",
    "AWS_REGION": "${AWS_REGION:-us-east-1}",
    "DYNAMO_TABLE_NAME_AUDITS": "${DYNAMO_TABLE_NAME_AUDITS:-spacecat-services-audits}",
    "DYNAMO_TABLE_NAME_DATA": "${DYNAMO_TABLE_NAME_DATA:-spacecat-services-data}",
    "DYNAMO_TABLE_NAME_LATEST_AUDITS": "${DYNAMO_TABLE_NAME_LATEST_AUDITS:-spacecat-services-latest-audits}",
    "DYNAMO_TABLE_NAME_ORGANIZATIONS": "${DYNAMO_TABLE_NAME_ORGANIZATIONS:-spacecat-services-organizations}",
    "DYNAMO_INDEX_NAME_ALL_SITES": "${DYNAMO_INDEX_NAME_ALL_SITES:-spacecat-services-all-sites}",
    "DYNAMO_INDEX_NAME_ALL_LATEST_AUDIT_SCORES": "${DYNAMO_INDEX_NAME_ALL_LATEST_AUDIT_SCORES:-spacecat-services-all-latest-audit-scores}",
    "RUM_DOMAIN_KEY": "${RUM_DOMAIN_KEY:-}",
    "S3_SCRAPER_BUCKET_NAME": "${S3_SCRAPER_BUCKET_NAME:-spacecat-scraper-results}",
    "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN:-}",
    "SLACK_OPS_CHANNEL_WORKSPACE": "${SLACK_OPS_CHANNEL_WORKSPACE:-}",
    "SLACK_REPORT_CHANNEL_ID": "${SLACK_REPORT_CHANNEL_ID:-}",
    "SQS_QUEUE_URL": "${SQS_QUEUE_URL:-}",
    "USE_LOCAL_SCRAPER_DATA": "$NEW_USE_LOCAL",
    "USE_LOCAL_TOP_PAGES": "$USE_LOCAL_TOP_PAGES_VALUE",
    "TOP_PAGES_FILE": "$TOP_PAGES_FILE_VALUE"
  }
}
EOF

echo "✅ Created env.json with AWS credentials"
echo ""

# Validate JSON syntax
if ! python3 -m json.tool "$AUDIT_WORKER_DIR/env.json" > /dev/null 2>&1; then
    echo "❌ ERROR: env.json has invalid JSON syntax!"
    echo "   Please check the file manually:"
    echo "   cat $AUDIT_WORKER_DIR/env.json"
    exit 1
fi

echo "🔍 Environment variables being passed to Lambda:"
echo "   USE_LOCAL_SCRAPER_DATA: '$NEW_USE_LOCAL'"
echo "   USE_LOCAL_TOP_PAGES: '$USE_LOCAL_TOP_PAGES_VALUE'"
echo "   TOP_PAGES_FILE: '$TOP_PAGES_FILE_VALUE'"
echo ""
echo "📄 Full env.json contents:"
cat "$AUDIT_WORKER_DIR/env.json"
echo ""

echo "📝 Creating local-config.json for Lambda to read directly..."
# Create a config file that the Lambda can read from the filesystem
# This bypasses SAM's env var issues
cat > "$AUDIT_WORKER_DIR/local-config.json" <<EOF
{
  "USE_LOCAL_SCRAPER_DATA": $NEW_USE_LOCAL,
  "USE_LOCAL_TOP_PAGES": $USE_LOCAL_TOP_PAGES_VALUE,
  "TOP_PAGES_FILE": "$TOP_PAGES_FILE_VALUE"
}
EOF

echo "✅ Created local-config.json"

# Copy the config file and urls-to-scrape.txt into the build directory so SAM can access them
BUILD_DIR="$AUDIT_WORKER_DIR/.aws-sam/build/SpacecatAuditWorkerFunction"
if [ -d "$BUILD_DIR" ]; then
    cp "$AUDIT_WORKER_DIR/local-config.json" "$BUILD_DIR/local-config.json"
    echo "✅ Copied local-config.json to build directory"
    
    # Copy urls-to-scrape.txt if it exists
    if [ -f "$TOP_PAGES_FILE_VALUE" ]; then
        cp "$TOP_PAGES_FILE_VALUE" "$BUILD_DIR/urls-to-scrape.txt"
        echo "✅ Copied urls-to-scrape.txt to build directory"
        
        # Update config to point to the local copy inside the container
        cat > "$BUILD_DIR/local-config.json" <<EOF
{
  "USE_LOCAL_SCRAPER_DATA": $NEW_USE_LOCAL,
  "USE_LOCAL_TOP_PAGES": $USE_LOCAL_TOP_PAGES_VALUE,
  "TOP_PAGES_FILE": "./urls-to-scrape.txt"
}
EOF
        echo "✅ Updated config to use relative path for urls-to-scrape.txt"
    else
        echo "⚠️  WARNING: urls-to-scrape.txt not found at $TOP_PAGES_FILE_VALUE"
    fi
else
    echo "⚠️  WARNING: Build directory not found, config may not be accessible"
fi

echo "📄 Config contents:"
cat "$AUDIT_WORKER_DIR/local-config.json"
echo ""

echo "🚀 Running audit worker..."
echo "=================="

# Export all environment variables so SAM Local can pick them up
# (using --env-vars alone doesn't always work reliably)
export USE_LOCAL_SCRAPER_DATA="$NEW_USE_LOCAL"
export USE_LOCAL_TOP_PAGES="$USE_LOCAL_TOP_PAGES_VALUE"
export TOP_PAGES_FILE="$TOP_PAGES_FILE_VALUE"

echo ""
echo "   📤 Exported environment variables to shell:"
echo "      USE_LOCAL_SCRAPER_DATA=$USE_LOCAL_SCRAPER_DATA"
echo "      USE_LOCAL_TOP_PAGES=$USE_LOCAL_TOP_PAGES"
echo "      TOP_PAGES_FILE=$TOP_PAGES_FILE"
echo ""

# Run SAM using the BUILT template (not source template)
# This ensures env vars from env.json are properly applied
# Filter out X-Ray errors at the shell level (only way to suppress them)
sam local invoke \
  --template .aws-sam/build/template.yaml \
  SpacecatAuditWorkerFunction \
  --env-vars "$AUDIT_WORKER_DIR/env.json" \
  2>&1 | grep -v "Missing AWS Lambda trace data for X-Ray" | tee output.txt

echo ""
echo "=================="
echo "✅ Audit worker execution complete!"
echo ""

# Open output file
if [ -f "output.txt" ]; then
    echo "📄 Output saved to: output.txt"
    echo ""
    
    read -p "Open output.txt? (Y/n): " OPEN_OUTPUT
    if [[ ! "$OPEN_OUTPUT" =~ ^[Nn] ]]; then
        echo "Opening output.txt in default editor..."
        open output.txt
    else
        echo "Skipped. You can view it manually:"
        echo "  cat $AUDIT_WORKER_DIR/output.txt"
        echo "  or"
        echo "  open $AUDIT_WORKER_DIR/output.txt"
    fi
else
    echo "⚠️  Warning: output.txt not found"
fi

# Cleanup temporary files
echo ""
echo "🗑️  Cleaning up temporary files..."
rm -f src/indexlocal.js
rm -f template-local.yml
rm -f env.json
rm -f env.json.debug
rm -f local-config.json
rm -f .aws-sam/build/SpacecatAuditWorkerFunction/local-config.json 2>/dev/null
rm -f .aws-sam/build/SpacecatAuditWorkerFunction/urls-to-scrape.txt 2>/dev/null
rm -rf .aws-sam/build/SpacecatAuditWorkerFunction/scraper-data 2>/dev/null

# Restore patched files
if [ -f "src/common/step-audit.js.backup" ]; then
    mv src/common/step-audit.js.backup src/common/step-audit.js
    echo "✅ Restored step-audit.js to original state"
fi

if [ -f "src/common/audit-utils.js.backup" ]; then
    mv src/common/audit-utils.js.backup src/common/audit-utils.js
    echo "✅ Restored audit-utils.js to original state"
fi

echo "✅ Cleaned up temporary files"

# Save settings to last-run config (for next time)
echo ""
echo "💾 Saving your settings for next run..."
cd "$SCRIPT_DIR"
write_config "audit.lastAuditType" "$NEW_AUDIT_TYPE"
write_config "audit.lastSiteId" "$NEW_SITE_ID"
write_config "audit.lastUseLocalData" "$NEW_USE_LOCAL"
echo "✅ Settings saved to .last-run-config.json"

# Always restore original git-tracked index-local.js in audit worker
cd "$AUDIT_WORKER_DIR"
if [ -f "src/index-local.js.original" ]; then
    mv src/index-local.js.original src/index-local.js
    echo "✅ Restored index-local.js to original git-tracked state"
fi

echo ""
echo "Done! 🎉"
echo ""
echo "💡 Your settings are remembered for next run - just press ENTER to reuse them!"

