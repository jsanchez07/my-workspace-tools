#!/bin/bash

# fetch-broken-links.sh
# Fetches broken internal links from RUM API for a site
# Usage: ./fetch-broken-links.sh

set -e

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

# Prompt for Site ID
echo "📋 Enter the Site ID for the broken links audit"
echo ""
read -p "Site ID: " SITE_ID

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
echo "🔑 Enter RUM domain key"
echo "   Get it from: https://aemcs-workspace.adobe.com/customer/generate-rum-domain-key"
echo ""
read -p "RUM domain key: " RUM_DOMAIN_KEY

if [ -z "$RUM_DOMAIN_KEY" ]; then
    echo "❌ RUM domain key is required for fetching broken links"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Will fetch broken links for:"
echo "  Site ID: $SITE_ID"
echo "  Output: broken-links-${SITE_ID}.json"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Change to audit worker directory
cd "$AUDIT_WORKER_DIR"

# Update index-local.js with the site ID and audit type
echo "📝 Updating index-local.js..."
node -e "
const fs = require('fs');
let content = fs.readFileSync('src/index-local.js', 'utf8');

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
console.log('✅ Updated index-local.js');
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

sam build --template template-local.yml

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

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

# Run SAM local invoke
echo "🚀 Fetching broken links from RUM API..."
echo "=================="
echo ""

export RUM_DOMAIN_KEY="$RUM_DOMAIN_KEY"

sam local invoke \
  --template .aws-sam/build/template.yaml \
  SpacecatAuditWorkerFunction \
  --env-vars env.json \
  2>&1 | tee broken-links-output.txt

echo ""
echo "═══════════════════════════════════════════════════════════════"

# Check if output contains broken links data
if grep -q "broken-internal-links audit" broken-links-output.txt; then
    echo "✅ Successfully fetched broken links data"
    echo ""
    echo "📄 Output saved to: broken-links-output.txt"
    echo ""
    echo "Next steps:"
    echo "  1. Review the broken links in the output"
    echo "  2. Run the scraper with those URLs"
    echo "  3. Run: ./run-audit-worker.sh (choose broken-internal-links)"
else
    echo "⚠️  Check broken-links-output.txt for results"
fi

echo ""

# Cleanup
rm -f env.json
rm -f template-local.yml
rm -f src/indexlocal.js

echo "✅ Done!"

