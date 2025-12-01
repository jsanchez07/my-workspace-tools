# Audit Worker - Local Testing Guide

## Quick Start

```bash
# 1. Load AWS credentials (from KLAM)
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=YOUR_ID_HERE')

# 2. Run an audit
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./run-audit-worker.sh
```

## Running Audits

The script is **interactive** and will prompt you for:

1. **Audit type** (e.g., `canonical`, `meta-tags`, `sitemap`)

2. **Data source**:
   - For `canonical`/`hreflang`: Use local URL list? (from `urls-to-scrape.txt`)
   - For other audits: Use local scraper data? (`true` = local files, `false` = S3)

3. **Site ID** (must match scraper's SITE_ID if using local data)

## Audit Types

### Audits That Work Fully Offline with Local Scraper Data
These audits use local scraper results and work completely offline:
- `meta-tags` - Meta tags analysis ✅ RECOMMENDED FOR LOCAL TESTING
- `product-metatags` - Product meta tags
- `structured-data` - Schema.org data

### Audits That Require Network Access
These audits fetch live URLs and need network access:
- `canonical` - Validates canonical tags by fetching live pages
- `hreflang` - Uses `fetch()` to retrieve pages from web
- `404` - Checks for broken links
- `sitemap` - Downloads sitemap.xml
- `accessibility` - Runs live accessibility checks
- `lhs-mobile` - Lighthouse mobile (requires live page)
- `lhs-desktop` - Lighthouse desktop (requires live page)

**Note**: Network audits may show CSS parsing errors when fetching complex pages. For pure offline testing, use audits from the first category.

## What the Script Does

1. ✅ Syncs latest `index-local.js` from this repo to audit worker
2. ✅ Temporarily patches audit enablement checks (auto-restores after)
3. ✅ Creates AWS credentials file
4. ✅ Copies scraper data into build directory (if using local data)
5. ✅ Builds and runs audit with SAM Local
6. ✅ Cleans up ALL temporary files
7. ✅ Restores patched files

## Output

Results saved to:
```
~/Documents/GitHub/SPACECAT/spacecat-audit-worker/output.txt
```

Script clears this file before each run (no old output confusion).

## Requirements

1. **AWS Credentials**: Must be loaded in your terminal
   ```bash
   $(curl -s 'https://klam.corp.adobe.com/pastebin/?id=...')
   ```

2. **Scraper Data** (if using local mode for meta-tags audits):
   ```bash
   cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
   ./run-scraper.sh
   ```

3. **Top Pages URL List** (if running canonical/hreflang locally):
   ```bash
   cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
   ./get-top-pages.sh
   ```

4. **Matching Site ID**: When using local data, audit Site ID must match scraper's SITE_ID

## Troubleshooting

### "No AWS credentials!"
```bash
# Load credentials first
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=...')
```

### "No local scraper data found"
```bash
# Run scraper first
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./run-scraper.sh
```

### Site ID mismatch
The scraper's `local.js` file contains the `SITE_ID`. Make sure it matches what you use in the audit.

### Credentials expired mid-run
Reload them and run again:
```bash
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=...')
./run-audit-worker.sh
```

## How Patching Works

For local testing, the script:
1. **Backs up** `step-audit.js` and `audit-utils.js`
2. **Patches** them to bypass audit enablement checks
3. **Runs** the audit
4. **Restores** the original files

This happens automatically and keeps git clean (no commits needed).

## Files & Cleanup

### Temporary Files (Auto-Deleted)
- `src/indexlocal.js` - Hyphen-free handler copy
- `template-local.yml` - Template with hyphen-free handler  
- `env.json` - AWS credentials
- `local-config.json` - Local configuration
- `scraper-data/` - Local scraper data copy (in build dir)
- `step-audit.js.backup` - Backup during patching
- `audit-utils.js.backup` - Backup during patching

### Persistent Files (Auto-Synced)
- `src/index-local.js` - Auto-synced from/to `my-workspace-tools/index-local.js`
  - Synced FROM central repo before audit runs
  - Synced BACK to central repo if you save changes
  - No manual syncing needed!

### Git Status After Running
```bash
git status
# Should show: nothing to commit, working tree clean ✅
# No untracked files ✅
```

## Tips

- **Canonical/Hreflang audits**: Use local URL list from `urls-to-scrape.txt`
- **Meta-tags audits**: Use local scraper data (`true`)
- **Keep changes**: Say "y" to persist your audit config in `index-local.js`
- **Revert changes**: Say "n" to restore original

---

**That's it!** The script handles everything automatically. 🚀

