#!/bin/bash

# fetch-broken-links.sh
# Fetches broken internal links from RUM API for a site
# Usage: ./fetch-broken-links.sh

set -e

# Cleanup function to restore files if script exits early
cleanup_on_exit() {
    cd "$AUDIT_WORKER_DIR" 2>/dev/null || return
    
    # Restore index-local.js to original git-tracked version
    if [ -f "src/index-local.js.original" ]; then
        echo ""
        echo "🔄 Restoring index-local.js to git-tracked version..."
        mv src/index-local.js.original src/index-local.js
        echo "✅ index-local.js restored"
    fi
    
    # Clean up temporary files
    rm -f src/indexlocal.js 2>/dev/null
    rm -f template-local.yml 2>/dev/null
    rm -f env.json 2>/dev/null
}

# Set trap to cleanup on exit (Ctrl+C, error, or normal exit)
trap cleanup_on_exit EXIT INT TERM

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         FETCH BROKEN INTERNAL LINKS (Step 1)              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "This script fetches broken link data from RUM API and saves"
echo "it locally for the broken-internal-links audit."
echo ""

# Get paths
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SPACECAT_DIR="$(dirname "$SCRIPT_DIR")"
AUDIT_WORKER_DIR="$SPACECAT_DIR/spacecat-audit-worker"

# Source config helpers for last-run tracking
source "$SCRIPT_DIR/config-helpers.sh"

# Check if audit worker exists
if [ ! -d "$AUDIT_WORKER_DIR" ]; then
    echo "❌ ERROR: Could not find spacecat-audit-worker directory"
    echo "   Expected at: $AUDIT_WORKER_DIR"
    exit 1
fi

# Check for AWS credentials
if [ -z "$AWS_REGION" ] && [ -z "$AWS_PROFILE" ]; then
    echo "⚠️  WARNING: No AWS credentials detected!"
    echo ""
    echo "You need AWS credentials to run this script."
    echo ""
    echo "Options:"
    echo "  1. Run: aws sso login --profile <your-profile>"
    echo "  2. Export AWS_PROFILE=<your-profile>"
    echo "  3. Source env.sh if you have one"
    echo ""
    
    # Check for env.sh
    if [ -f "$AUDIT_WORKER_DIR/env.sh" ]; then
        echo "📋 Found env.sh file - you can source it"
        echo ""
        read -p "Load credentials from env.sh now? (y/N): " LOAD_ENV
        if [[ "$LOAD_ENV" =~ ^[Yy] ]]; then
            source "$AUDIT_WORKER_DIR/env.sh"
            echo "✅ Loaded credentials from env.sh"
        else
            echo "Cancelled. Please set up AWS credentials first."
            exit 0
        fi
    else
        read -p "Continue anyway? (y/N): " CONTINUE_NO_CREDS
        if [[ ! "$CONTINUE_NO_CREDS" =~ ^[Yy] ]]; then
            echo "Cancelled. Please set up AWS credentials first."
            exit 0
        fi
    fi
    echo ""
fi

# Read last run values
LAST_SITE_ID=$(read_config "brokenLinks.lastSiteId")
LAST_BASE_URL=$(read_config "brokenLinks.lastBaseUrl")
LAST_RUM_KEY=$(read_config "brokenLinks.lastRumDomainKey")

# Prompt for Site ID with default
echo "📋 Enter the Site ID for the broken links audit"
if [ -n "$LAST_SITE_ID" ]; then
    echo "   (Press Enter to use last: $LAST_SITE_ID)"
fi
echo ""
read -p "Site ID: " SITE_ID

# Use last value if empty
if [ -z "$SITE_ID" ] && [ -n "$LAST_SITE_ID" ]; then
    SITE_ID="$LAST_SITE_ID"
    echo "Using last Site ID: $SITE_ID"
fi

if [ -z "$SITE_ID" ]; then
    echo "❌ Site ID is required"
    exit 1
fi

# Validate UUID format
UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
if [[ ! "$SITE_ID" =~ $UUID_PATTERN ]]; then
    echo ""
    echo "⚠️  WARNING: Site ID doesn't match UUID format"
    echo "   Provided: $SITE_ID"
    echo ""
    read -p "Continue anyway? (y/N): " CONTINUE_BAD_UUID
    if [[ ! "$CONTINUE_BAD_UUID" =~ ^[Yy] ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

echo ""
echo "📋 Enter the base URL for the site"
echo "   (e.g., https://www.example.com)"
if [ -n "$LAST_BASE_URL" ]; then
    echo "   (Press Enter to use last: $LAST_BASE_URL)"
fi
echo ""
read -p "Base URL: " BASE_URL

# Use last value if empty
if [ -z "$BASE_URL" ] && [ -n "$LAST_BASE_URL" ]; then
    BASE_URL="$LAST_BASE_URL"
    echo "Using last Base URL: $BASE_URL"
fi

if [ -z "$BASE_URL" ]; then
    echo "❌ Base URL is required to query RUM API"
    exit 1
fi

echo ""
echo "🔑 Enter RUM domain key"
echo "   Get it from: https://aemcs-workspace.adobe.com/customer/generate-rum-domain-key"
if [ -n "$LAST_RUM_KEY" ]; then
    # Show masked version of last key
    MASKED_KEY="${LAST_RUM_KEY:0:8}...${LAST_RUM_KEY: -8}"
    echo "   (Press Enter to use last: $MASKED_KEY)"
fi
echo ""
read -p "RUM domain key: " RUM_DOMAIN_KEY

# Use last value if empty
if [ -z "$RUM_DOMAIN_KEY" ] && [ -n "$LAST_RUM_KEY" ]; then
    RUM_DOMAIN_KEY="$LAST_RUM_KEY"
    echo "Using last RUM domain key"
fi

if [ -z "$RUM_DOMAIN_KEY" ]; then
    echo "❌ RUM domain key is required for fetching broken links"
    exit 1
fi

# Save values immediately after collection (before any failures can happen)
echo ""
echo "💾 Saving configuration for next run..."
write_config "brokenLinks.lastSiteId" "$SITE_ID"
write_config "brokenLinks.lastBaseUrl" "$BASE_URL"
write_config "brokenLinks.lastRumDomainKey" "$RUM_DOMAIN_KEY"
echo "✅ Configuration saved"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Will fetch broken links for:"
echo "  Site ID: $SITE_ID"
echo "  Base URL: $BASE_URL"
echo "  Full output: broken-links-${SITE_ID}.txt"
echo "  JSON result: broken-links-${SITE_ID}.json"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Change to audit worker directory
cd "$AUDIT_WORKER_DIR"

# ============================================================================
# BACKUP & SYNC: Save original, then copy from central repo
# ============================================================================
echo "💾 Backing up original index-local.js from audit worker repo..."
if [ -f "src/index-local.js" ]; then
    cp "src/index-local.js" "src/index-local.js.original"
    echo "✅ Saved backup of git-tracked version"
    echo ""
else
    echo "⚠️  Warning: index-local.js not found in audit worker"
    echo ""
fi

echo "🔄 Syncing index-local.js from central repo..."
if [ -f "$SCRIPT_DIR/index-local.js" ]; then
    cp "$SCRIPT_DIR/index-local.js" "src/index-local.js"
    echo "✅ Synced latest index-local.js from my-workspace-tools"
    echo ""
else
    echo "❌ Error: $SCRIPT_DIR/index-local.js not found"
    exit 1
fi

# Update the COPIED index-local.js with site ID, base URL, RUM key, and audit type (temporary changes)
echo ""
echo "📝 Updating index-local.js with site ID, base URL, RUM key, and audit type..."
node -e "
const fs = require('fs');
let content = fs.readFileSync('src/index-local.js', 'utf8');

// Inject RUM_DOMAIN_KEY into process.env at the very top of the file
// This ensures the RUM API client can access it
const rumKeyInjection = \`
// ============================================================================
// RUM DOMAIN KEY INJECTION (for local testing)
// ============================================================================
// Injected by fetch-broken-links.sh for this run only
process.env.RUM_DOMAIN_KEY = '${RUM_DOMAIN_KEY}';
console.log('🔧 [INJECTED] RUM_DOMAIN_KEY set in process.env');

\`;

// Find the first import statement and insert before it
const firstImportIndex = content.indexOf('import ');
if (firstImportIndex > 0) {
  content = content.substring(0, firstImportIndex) + rumKeyInjection + content.substring(firstImportIndex);
}

// Update site ID
content = content.replace(
  /siteId: '[^']+',/,
  \"siteId: '${SITE_ID}',\"
);

// Update audit type
content = content.replace(
  /type: '[^']+',\s*\/\/\s*<<--.*$/m,
  \"type: 'broken-internal-links', // <<-- name of the audit\"
);

// Add site ID to URL map
content = content.replace(
  /const siteUrlMap = \{/,
  \"const siteUrlMap = {\\n      '${SITE_ID}': '${BASE_URL}',\"
);

// Comment out auditContext (run from Step 1)
if (/^\s*auditContext:\s*\{/m.test(content) && !/^\s*\/\/\s*auditContext/m.test(content)) {
  const lines = content.split('\n');
  let inAuditContext = false;
  let commentedLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (/^\s*auditContext:\s*\{/.test(line)) {
      inAuditContext = true;
      commentedLines.push(line.replace(/^(\s*)/, '\$1// '));
    } else if (inAuditContext && /^\s*\},/.test(line)) {
      commentedLines.push(line.replace(/^(\s*)/, '\$1// '));
      inAuditContext = false;
    } else if (inAuditContext) {
      commentedLines.push(line.replace(/^(\s*)/, '\$1// '));
    } else {
      commentedLines.push(line);
    }
  }
  
  content = commentedLines.join('\n');
}

fs.writeFileSync('src/index-local.js', content);
console.log('✅ Updated index-local.js (temporary changes for this run)');
console.log('   Site ID: ${SITE_ID}');
console.log('   Base URL: ${BASE_URL}');
console.log('   RUM Domain Key: Injected into process.env');
"

if [ $? -ne 0 ]; then
    echo "❌ Error updating index-local.js"
    exit 1
fi

# Clean and build
echo ""
echo "🔨 Building audit worker..."
if [ -d ".aws-sam" ]; then
    rm -rf .aws-sam
fi

# Create hyphen-free copy for SAM
cp src/index-local.js src/indexlocal.js

# Create template-local.yml
sed 's|Handler: src/index-local\.main|Handler: src/indexlocal.main|' template.yml > template-local.yml

# Build quietly
sam build --template template-local.yml > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Run without redirect to see errors:"
    echo "   sam build --template template-local.yml"
    exit 1
fi

echo "✅ Build complete"

# Create env.json with RUM domain key
echo ""
echo "📝 Creating env.json with RUM domain key..."
cat > env.json <<EOF
{
  "SpacecatAuditWorkerFunction": {
    "AWS_REGION": "${AWS_REGION:-us-east-1}",
    "DYNAMO_TABLE_NAME_DATA": "${DYNAMO_TABLE_NAME_DATA:-spacecat-services-data}",
    "RUM_DOMAIN_KEY": "$RUM_DOMAIN_KEY"
  }
}
EOF

echo "✅ Created env.json"
echo ""

# Also export as environment variable so RUM client can find it
export RUM_DOMAIN_KEY="$RUM_DOMAIN_KEY"

# Run SAM local invoke
echo "🚀 Fetching broken links from RUM API..."
echo "   (This may take a minute...)"
echo ""
echo "⚠️  NOTE: You may see an SQS error at the end - this is expected!"
echo "   We only need Step 1's output (RUM data), not Steps 2-3."
echo ""

# Create local-data directory if it doesn't exist
mkdir -p "$SCRIPT_DIR/local-data"

# Set output file names based on site ID (output to local-data subdirectory)
OUTPUT_TXT="$SCRIPT_DIR/local-data/broken-links-${SITE_ID}.txt"
OUTPUT_JSON="$SCRIPT_DIR/local-data/broken-links-${SITE_ID}.json"

export RUM_DOMAIN_KEY="$RUM_DOMAIN_KEY"

# Redirect all output (stdout and stderr) to file, with X-Ray noise filtering
sam local invoke \
  --template .aws-sam/build/template.yaml \
  SpacecatAuditWorkerFunction \
  --env-vars env.json \
  2>&1 | grep -v -E \
  "(\
^.*(getTraceId|log-wrapper\.js|xray\.js|Missing AWS Lambda trace data|aws-xray-sdk).*$\
|^\\s+at (getTraceId|tracingFetch|isLinkInaccessible|internalLinksAuditRunner)\
|^\\s+at file:\\/\\/\\/var\\/task\\/(src|node_modules)\\/.*\\.js:[0-9]+:[0-9]+$\
|^\\s+at (limitConcurrencyAllSettled|limitConcurrency|async |process\\.processTicksAndRejections)\
|^\\s+at (async )?RunnerAudit\\.\
|^\\s+at (async )?(run|Runtime\\.main)\
|^\\s+at Array\\.map\
|^\\s+at Object\\.(runAuditAndImportTopPagesStep|contextMissingLogError)\
|^\\s+at StepAudit\\.run\
|^\\s+at Segment\\.resolveLambdaTraceData\
|^\\s+at Object\\.getSegment\
)" \
  > "$OUTPUT_TXT"

echo "✅ Audit execution complete"

echo ""
echo "═══════════════════════════════════════════════════════════════"

# Extract JSON result from Lambda output
echo "📝 Extracting broken links data to JSON..."

# Look for the logged broken links data from the Audit.create mock
if grep -q "BROKEN INTERNAL LINKS DATA" "$OUTPUT_TXT"; then
    # Extract the JSON between "Broken Links Data (JSON):" and the next separator line
    # Also strip the Lambda log timestamp prefix (e.g., "2025-12-11T00:24:16.249Z	<id>	INFO	")
    awk '/Broken Links Data \(JSON\):/{flag=1;next}/═══════════════════/{if(flag)exit}flag' "$OUTPUT_TXT" \
      | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z[[:space:]]+[a-f0-9-]+[[:space:]]+INFO[[:space:]]+//' \
      > "$OUTPUT_JSON"
    
    # If extraction resulted in empty file, set to empty object
    if [ ! -s "$OUTPUT_JSON" ]; then
        echo "{}" > "$OUTPUT_JSON"
    fi
else
    # No data logged (likely zero broken links found)
    echo "{}" > "$OUTPUT_JSON"
fi

# Check if RUM query actually failed (not just SQS error)
if grep -q "Could not retrieved RUM domainkey" "$OUTPUT_TXT" || grep -q "Query '404-internal-links' failed" "$OUTPUT_TXT"; then
    echo "❌ RUM API query failed - check output for errors"
    echo ""
    echo "📄 Full output: $OUTPUT_TXT"
    echo ""
    
    # Show the RUM error
    echo "Error details:"
    grep -E "(Could not retrieved RUM domainkey|Query '404-internal-links' failed)" "$OUTPUT_TXT" | head -5
    echo ""
    echo "💡 Make sure:"
    echo "   • The base URL is correct"
    echo "   • The RUM domain key is valid"
    echo "   • The site has RUM data"
    echo ""
    
    read -p "Open output file to see full details? (Y/n): " OPEN_FILE
    if [[ ! "$OPEN_FILE" =~ ^[Nn] ]]; then
        if command -v code &> /dev/null; then
            code "$OUTPUT_TXT"
        elif command -v open &> /dev/null; then
            open "$OUTPUT_TXT"
        else
            echo "Please open: $OUTPUT_TXT"
        fi
    fi
elif grep -q "The specified queue does not exist" "$OUTPUT_TXT"; then
    # SQS error is expected for local testing - Step 1 likely succeeded
    echo "✅ Step 1 completed (RUM data query)"
    echo "⚠️  SQS error (expected for local testing)"
    echo ""
    echo "📄 Full output (logs): $OUTPUT_TXT"
    echo "📄 Audit result (JSON): $OUTPUT_JSON"
    echo ""
    
    # Check if we got any data
    echo "💡 Note: The SQS error happens after Step 1 completes."
    echo "   Check the audit result to see if any broken links were found."
    echo ""
    
    echo "Next steps:"
    echo "  1. Review the output files to check for broken links data"
    echo "  2. If data was found, follow the multi-step audit workflow"
    echo ""
    
    read -p "Open output file now? (Y/n): " OPEN_FILE
    if [[ ! "$OPEN_FILE" =~ ^[Nn] ]]; then
        if command -v open &> /dev/null; then
            open "$OUTPUT_TXT"
        elif command -v code &> /dev/null; then
            code "$OUTPUT_TXT"
        else
            echo "Please open: $OUTPUT_TXT"
        fi
    fi
else
    echo "✅ Audit completed"
    echo ""
    
    # Check if broken links data was found
    if [ -f "$OUTPUT_JSON" ] && [ -s "$OUTPUT_JSON" ]; then
        LINK_COUNT=$(cat "$OUTPUT_JSON" | jq -r '.brokenInternalLinks | length' 2>/dev/null || echo "0")
        if [ "$LINK_COUNT" -gt 0 ]; then
            echo "🔗 Found $LINK_COUNT broken internal links"
        else
            echo "✅ No broken internal links found (site is healthy!)"
        fi
    else
        echo "⚠️  No data extracted (check logs for errors)"
    fi
    
    echo ""
    echo "📄 Full output (logs): $OUTPUT_TXT"
    echo "📄 Audit result (JSON): $OUTPUT_JSON"
    echo ""
    
    read -p "Open output file now? (Y/n): " OPEN_FILE
    if [[ ! "$OPEN_FILE" =~ ^[Nn] ]]; then
        if command -v open &> /dev/null; then
            open "$OUTPUT_TXT"
        elif command -v code &> /dev/null; then
            code "$OUTPUT_TXT"
        else
            echo "Please open: $OUTPUT_TXT"
        fi
    fi
fi

echo ""
echo "✅ Done!"
echo ""
echo "Note: index-local.js will be restored to git-tracked version automatically"

