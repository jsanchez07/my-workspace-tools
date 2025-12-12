#!/bin/bash
# Helper functions for reading/writing last-run config

CONFIG_FILE=".last-run-config.json"

# Initialize config file if it doesn't exist
init_last_run_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        cat > "$CONFIG_FILE" <<'EOF'
{
  "audit": {
    "lastAuditType": "",
    "lastSiteId": "",
    "lastUseLocalData": false,
    "lastUseLocalUrls": false
  },
  "scraper": {
    "lastSiteId": ""
  },
  "brokenLinks": {
    "lastSiteId": "",
    "lastBaseUrl": "",
    "lastRumDomainKey": ""
  }
}
EOF
    fi
}

# Read a value from config
# Usage: read_config "audit.lastAuditType"
read_config() {
    local key="$1"
    init_last_run_config
    
    # Use node to parse JSON (more reliable than jq which may not be installed)
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
const keys = '$key'.split('.');
let value = config;
for (const k of keys) {
  value = value[k];
  if (value === undefined) break;
}
console.log(value || '');
" 2>/dev/null || echo ""
}

# Write a value to config
# Usage: write_config "audit.lastAuditType" "canonical"
write_config() {
    local key="$1"
    local value="$2"
    init_last_run_config
    
    # Use node to update JSON
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
const keys = '$key'.split('.');
let obj = config;
for (let i = 0; i < keys.length - 1; i++) {
  obj = obj[keys[i]];
}
obj[keys[keys.length - 1]] = '$value' === 'true' ? true : '$value' === 'false' ? false : '$value';
fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
" 2>/dev/null
}

