# Audit Worker - Local Testing Guide

## Quick Start

```bash
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./run-audit-worker.sh
```

**Note:** AWS credentials are **NOT required** for local testing. All AWS services are mocked.

## Running Audits

The script is **interactive** and will prompt you for:

1. **Audit type** (e.g., `canonical`, `meta-tags`, `sitemap`)

2. **Data source**:
   - For `canonical`/`hreflang`: Use local URL list? (from `urls-to-scrape.txt`)
   - For other audits: Use local scraper data? (`true` = local files, `false` = S3)

3. **Site ID** (must match scraper's SITE_ID if using local data)

## Audit Types

### Audits Using Local Scraper Data (Offline)
These audits use local scraper results and work completely offline:
- `canonical` - Validates canonical tags ✅
- `hreflang` - Validates hreflang tags ✅
- `meta-tags` - Meta tags analysis ✅ (Note: AI suggestions skipped locally)
- `structured-data` - Schema.org validation ✅ (Note: AI suggestions skipped locally)

### Audits Fetching Live Data (Network Required)
These audits fetch data from live websites:
- `sitemap` - Downloads and validates sitemap.xml ✅
- `redirect-chains` - Validates redirects.json file ✅

### Multi-Step Audits (Special Workflow)
- `broken-internal-links` - Requires 2 steps:
  1. Run `./fetch-broken-links.sh` to fetch RUM data (requires RUM domain key)
  2. Run `./run-audit-worker.sh` and select `broken-internal-links`
  - Note: AI suggestions are skipped locally (would require Mystique AI service)

### Requirements Summary

| Audit | Requires | Data Source | AI Suggestions |
|-------|----------|-------------|----------------|
| `canonical` | Local scraper data | `local-data/urls-to-scrape.txt` | N/A |
| `hreflang` | Local scraper data | `local-data/urls-to-scrape.txt` | N/A |
| `meta-tags` | Local scraper data | Scraper files | Skipped (would need Genvar AI) |
| `structured-data` | Local scraper data | Scraper files | Skipped (would need Mystique AI) |
| `sitemap` | Network access | Live website | N/A |
| `redirect-chains` | Network access | Live website | N/A |
| `broken-internal-links` | RUM domain key | RUM API | Skipped (would need Mystique AI) |

## What the Script Does

1. ✅ Syncs latest `index-local.js` from this repo to audit worker
2. ✅ Temporarily patches audit enablement checks (auto-restores after)
3. ✅ Creates AWS credentials file
4. ✅ Copies scraper data into build directory (if using local data)
5. ✅ Builds and runs audit with SAM Local
6. ✅ Cleans up ALL temporary files
7. ✅ Restores patched files

## Output

### Audit Results
Results saved to:
```
~/Documents/GitHub/SPACECAT/spacecat-audit-worker/output.txt
```

Script clears this file before each run (no old output confusion).

The output is **filtered** to remove:
- AWS X-Ray traces
- Orphaned Node.js stack traces
- Verbose SQS messages

You'll see clean, relevant audit results and suggestions.

### Generated Data Files
All generated test data is in:
```
~/Documents/GitHub/SPACECAT/my-workspace-tools/local-data/
```

See `local-data/README.md` for details on what each file contains.

## Requirements

### For Scraper-Based Audits (canonical, hreflang, meta-tags, structured-data)

1. **Top Pages URL List**:
   ```bash
   cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
   ./get-top-pages.sh
   ```
   This creates `local-data/urls-to-scrape.txt`

2. **Scraper Data**:
   ```bash
   ./run-scraper.sh
   ```
   This scrapes the URLs and saves data for audits to use

3. **Matching Site ID**: When using local data, audit Site ID must match scraper's SITE_ID

### For Broken Internal Links Audit

1. **RUM Domain Key**: Get from RUM API key generator
2. **Fetch Broken Links Data**:
   ```bash
   ./fetch-broken-links.sh
   ```
   This creates `local-data/broken-links-{SITE_ID}.json` for the audit to use

### For Live Data Audits (sitemap, redirect-chains)

- **Network Access**: These fetch data directly from the website (no setup needed)

## Troubleshooting

### "No local scraper data found"
```bash
# Run scraper first
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./run-scraper.sh
```

### "urls-to-scrape.txt not found"
```bash
# Get top pages first
./get-top-pages.sh
```

### Site ID mismatch
The scraper's `local.js` file contains the `SITE_ID`. Make sure it matches what you use in the audit.

### Site ID not in mock map
If using a new site, add it to `index-local.js`:
```javascript
const siteUrlMap = {
  'your-site-id-here': 'https://your-site-url.com',
  // ... other sites
};
```

### Broken-internal-links audit fails at Step 2
Make sure you ran `./fetch-broken-links.sh` first to generate the required `broken-links-{SITE_ID}.json` file.

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

- **Most audits work offline**: No AWS credentials needed!
- **Broken-internal-links**: Run `fetch-broken-links.sh` first
- **Live data audits** (sitemap, redirect-chains): Just need network access
- **AI suggestions**: Skipped locally for meta-tags, structured-data, and broken-internal-links (would require production AI services)
- **Adding new sites**: Add Site ID to `siteUrlMap` in `index-local.js`
- **Clean output**: Verbose logs are automatically filtered out

---

**That's it!** The script handles everything automatically. 🚀

