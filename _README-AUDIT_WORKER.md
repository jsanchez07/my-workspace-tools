# Audit Worker - Local Testing Guide

## Quick Start

```bash
# 1. Load AWS credentials (from KLAM)
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=YOUR_ID_HERE')

# 2. Run an audit
cd ~/Documents/my-workspace-tools
./run-audit-worker.sh
```

## Running Audits

The script is **interactive** and will prompt you for:

1. **Use local scraper data?** (`true` or `false`)
   - `true` = Use local files from scraper
   - `false` = Use real S3 data

2. **Audit type** (e.g., `meta-tags`, `sitemap`, `canonical`)

3. **Site ID** (must match scraper's SITE_ID if using local data)

## Audit Types

### Audits That Work Fully Offline with Local Scraper Data
These audits use `context.scrapeResultPaths` and work completely offline:
- `meta-tags` - Meta tags analysis ✅ RECOMMENDED FOR LOCAL TESTING
- `product-metatags` - Product meta tags
- `structured-data` - Schema.org data

### Audits That Require Network Access
These audits fetch live URLs and need network access even in local mode:
- `hreflang` - Uses `fetch()` to retrieve pages from web
- `canonical` - Fetches URLs to validate canonical tags
- `404` - Checks for broken links
- `sitemap` - Downloads sitemap.xml
- `accessibility` - Runs live accessibility checks
- `lhs-mobile` - Lighthouse mobile (requires live page)
- `lhs-desktop` - Lighthouse desktop (requires live page)
- `prerender` - Checks prerender implementation
- `preflight` - Pre-flight validation checks

**Note**: Audits requiring network access may encounter errors like "Could not parse CSS stylesheet" when fetching complex pages. For pure offline testing, use audits from the first category.

## Quick Meta-Tags Run

For **meta-tags only** without prompts:

```bash
./run-meta-tags.sh
```

Assumes `index-local.js` is already configured.

## What the Script Does

### For Multi-Step Audits with Local Data:
1. ✅ Temporarily patches `step-audit.js` (auto-restores after)
2. ✅ Creates `template-local.yml` from `template.yml`
3. ✅ Copies scraper data into project
4. ✅ Creates AWS credentials file
5. ✅ Builds and runs audit
6. ✅ Cleans up ALL temporary files

### For Single-Step Audits:
1. ✅ Builds and runs audit normally
2. ✅ No patching needed
3. ✅ Cleans up temporary files

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

2. **Scraper Data** (if using local mode):
   ```bash
   cd ~/Documents/GitHub/SPACECAT/spacecat-content-scraper
   npm run local
   ```

3. **Matching Site ID**: When using local data, audit Site ID must match scraper's SITE_ID

## Troubleshooting

### "No AWS credentials!"
```bash
# Load credentials first
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=...')
```

### "No local scraper data found"
```bash
# Run scraper first
cd ~/Documents/GitHub/SPACECAT/spacecat-content-scraper
npm run local
```

### Site ID mismatch
Edit the scraper's `local.js` file and ensure `SITE_ID` matches what you use in the audit.

### Credentials expired mid-run
Reload them and run again:
```bash
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=...')
./run-audit-worker.sh
```

## How Multi-Step Patching Works

For multi-step audits, the script:
1. **Backs up** `step-audit.js`
2. **Patches** it to add mock ID detection
3. **Runs** the audit
4. **Restores** the original file

This happens automatically and keeps git clean (no commits needed).

## Files & Cleanup

### Temporary Files (Auto-Deleted)
- `src/indexlocal.js` - Hyphen-free handler
- `template-local.yml` - Template with hyphen-free handler  
- `env.json` - AWS credentials
- `scraper-data/` - Local scraper data copy
- `step-audit.js.backup` - Backup during patching

### Persistent Files (You Control)
- `src/index-local.js` - Your local config
  - Script asks if you want to keep changes

### Git Status After Running
```bash
git status
# Shows only: M src/index-local.js (optional)
# No untracked files ✅
# No .gitignore changes ✅
```

## Tips

- **Single-step audits**: No scraper data needed, use `false` for local data
- **Multi-step audits**: Need scraper data, use `true` for local data  
- **Keep changes**: Say "y" to persist your audit config
- **Revert changes**: Say "n" to restore original

---

**That's it!** The script handles everything automatically. 🚀

