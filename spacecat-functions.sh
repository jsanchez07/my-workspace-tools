#!/bin/bash

# ============================================================================
# SpaceCat Shell Functions
# ============================================================================
# Add these to your ~/.zshrc or ~/.bashrc for persistent access
#
# To use:
#   source ~/Documents/my-workspace-tools/spacecat-functions.sh
#
# Then you can run:
#   spacecat-load-perms
#   spacecat-run-audit
#   spacecat-build
# ============================================================================

# Function to load AWS permissions from env.sh
spacecat-load-perms() {
    local AUDIT_WORKER_DIR="$HOME/Documents/GitHub/SPACECAT/spacecat-audit-worker"
    
    echo "🔑 Loading AWS permissions from env.sh..."
    
    # Source env.sh into current shell if it exists
    if [ -f "$AUDIT_WORKER_DIR/env.sh" ]; then
        echo ""
        echo "📥 Loading credentials into your terminal..."
        cd "$AUDIT_WORKER_DIR"
        source env.sh
        echo "✅ Credentials loaded and will persist in your terminal!"
    else
        echo "❌ env.sh not found in $AUDIT_WORKER_DIR"
        echo ""
        echo "💡 Make sure to load AWS credentials first (e.g., via klam):"
        echo "   \$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=YOUR_ID_HERE')"
        return 1
    fi
}

# Function to build audit worker
spacecat-build() {
    local AUDIT_WORKER_DIR="$HOME/Documents/GitHub/SPACECAT/spacecat-audit-worker"
    
    if [ ! -d "$AUDIT_WORKER_DIR" ]; then
        echo "❌ Audit worker directory not found"
        return 1
    fi
    
    cd "$AUDIT_WORKER_DIR"
    echo "🗑️  Cleaning SAM build cache..."
    rm -rf .aws-sam
    echo "🔨 Building audit worker (fresh build)..."
    sam build
}

# Function to run audit worker
spacecat-run-audit() {
    local AUDIT_WORKER_DIR="$HOME/Documents/GitHub/SPACECAT/spacecat-audit-worker"
    
    if [ ! -d "$AUDIT_WORKER_DIR" ]; then
        echo "❌ Audit worker directory not found"
        return 1
    fi
    
    cd "$AUDIT_WORKER_DIR"
    
    # Check if credentials are loaded
    if [ -z "$AWS_PROFILE" ] && [ -z "$AWS_ACCESS_KEY_ID" ]; then
        echo "⚠️  No AWS credentials detected!"
        echo "Run: spacecat-load-perms"
        return 1
    fi
    
    echo "✅ Using AWS credentials from terminal"
    echo ""
    
    # Clean and Build
    echo "🗑️  Cleaning SAM build cache..."
    rm -rf .aws-sam > /dev/null 2>&1
    echo "🔨 Building (fresh build)..."
    sam build > /dev/null 2>&1
    
    if [ $? -ne 0 ]; then
        echo "❌ Build failed!"
        return 1
    fi
    
    # Run
    echo "🚀 Running audit worker..."
    sam local invoke -l output.txt
    
    echo ""
    echo "✅ Done! Output: $AUDIT_WORKER_DIR/output.txt"
}

# Function to quickly rebuild and run
spacecat-quick() {
    spacecat-build && spacecat-run-audit
}

# Function to check if credentials are loaded
spacecat-check-creds() {
    echo "🔍 Checking AWS credentials in current shell..."
    echo ""
    
    if [ -n "$AWS_PROFILE" ]; then
        echo "✅ AWS_PROFILE: $AWS_PROFILE"
    else
        echo "❌ AWS_PROFILE: not set"
    fi
    
    if [ -n "$AWS_REGION" ]; then
        echo "✅ AWS_REGION: $AWS_REGION"
    else
        echo "❌ AWS_REGION: not set"
    fi
    
    if [ -n "$AWS_ACCESS_KEY_ID" ]; then
        echo "✅ AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:0:10}..."
    else
        echo "❌ AWS_ACCESS_KEY_ID: not set"
    fi
    
    if [ -n "$DYNAMO_TABLE_NAME_DATA" ]; then
        echo "✅ DYNAMO_TABLE_NAME_DATA: $DYNAMO_TABLE_NAME_DATA"
    else
        echo "❌ DYNAMO_TABLE_NAME_DATA: not set"
    fi
    
    echo ""
    
    if [ -n "$AWS_PROFILE" ] || [ -n "$AWS_ACCESS_KEY_ID" ]; then
        echo "✅ Credentials are loaded and ready to use!"
    else
        echo "⚠️  No credentials loaded. Run: spacecat-load-perms"
    fi
}

# Show available functions
spacecat-help() {
    cat << 'EOF'
╔════════════════════════════════════════════════════════════╗
║              SPACECAT SHELL FUNCTIONS                      ║
╚════════════════════════════════════════════════════════════╝

Available commands:

  spacecat-load-perms    Load AWS permissions into your terminal
  spacecat-build         Build the audit worker
  spacecat-run-audit     Run the audit worker (requires credentials)
  spacecat-quick         Build and run in one command
  spacecat-check-creds   Check if credentials are loaded
  spacecat-help          Show this help

Quick Start:
  1. spacecat-load-perms     # Load credentials once
  2. spacecat-run-audit      # Run as many times as you want!

Or:
  1. spacecat-load-perms
  2. spacecat-quick          # Build + run

Credentials persist for your entire terminal session!

EOF
}

echo "✅ SpaceCat functions loaded!"
echo "   Run 'spacecat-help' to see available commands"

