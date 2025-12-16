# Scraper - Local Testing Guide

## Quick Start

```bash
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./run-scraper.sh
```

## What It Does

1. ✅ Syncs latest `local.js` from this repo to scraper
2. ✅ Prompts for **Site ID** (or uses current from `local.js`)
3. ✅ Asks if you want to keep or delete existing scrape data
4. ✅ Automatically patches `abstract-handler.js` to remove hardcoded Chromium path
   - Removes the `executablePath: '/opt/homebrew/bin/chromium'` line
   - This fixes it for all handlers (DefaultHandler, etc.) since they inherit from abstract-handler
5. ✅ Runs the scraper locally
6. ✅ Restores `abstract-handler.js` after completion
7. ✅ Saves scraped data to:
   ```
   ~/Documents/GitHub/SPACECAT/spacecat-content-scraper/tmp/scrapes/<SITE_ID>/
   ```

## Requirements

The scraper needs a **list of URLs to scrape**. You can get them from:

### Option 1: Top 200 Pages (Recommended)
```bash
./get-top-pages.sh
```

This fetches the top 200 pages from SpaceCat API and saves them to `local-data/urls-to-scrape.txt`.

### Option 2: Manual URL List
Edit `local-data/urls-to-scrape.txt` and add URLs (one per line):
```
https://example.com/page1
https://example.com/page2
```

## Output Location

Scraped data is saved to:
```
spacecat-content-scraper/tmp/scrapes/<SITE_ID>/<page-path>/scrape.json
```

Example:
```
tmp/scrapes/2bf30198.../medicaid/scrape.json
tmp/scrapes/2bf30198.../value-based-care/scrape.json
```

## Using Scraped Data

After scraping, run audits with local data:

```bash
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./run-audit-worker.sh
# Select audit type: meta-tags (or other audit that uses scraper data)
# Select: true (use local scraper data)
# Enter: <same SITE_ID you scraped>
```

## Viewing Results

To open scraped data in your browser:

```bash
./open-scrape-results.sh
```

This serves the scraped data as HTML for easy viewing.

## Automatic Cleanup

The script automatically:
- ✅ Syncs latest `local.js` from central repo
- ✅ Patches `abstract-handler.js` before running
- ✅ Restores `abstract-handler.js` after completion
- ✅ Keeps git status clean (no uncommitted changes)

Even if you Ctrl+C or the script errors, the file is restored automatically.

### Why Patch abstract-handler.js?
- It's the base class for most handlers (DefaultHandler, etc.)
- Patching it once fixes the issue for all inherited handlers
- `prerender-handler.js` overrides `getBrowser()` so it's not affected by this patch

## Managing Scraped Data

When you run the scraper with a Site ID that already has data, you'll be asked:

1. **Delete and start fresh** - Removes all old scrapes for this site
2. **Keep existing and add to it** - Adds new URLs or overwrites duplicates
3. **Cancel** - Don't run scraper

## Troubleshooting

### "No URLs found in local-data/urls-to-scrape.txt"
Run the top 200 pages script first:
```bash
./get-top-pages.sh
```

Or manually add URLs to `local-data/urls-to-scrape.txt`.

### Site ID mismatch in audit
The scraper and audit must use the **same SITE_ID**. Check:
- Scraper: `cat ~/Documents/GitHub/SPACECAT/spacecat-content-scraper/local.js | grep SITE_ID`
- Then use that same Site ID when running the audit

### Chromium not found
The script automatically removes the hardcoded Chromium path so Puppeteer uses its bundled version. No manual editing needed!

### File Syncing
All syncing happens automatically:
- `local.js` is synced FROM central repo before scraper runs
- If you change SITE_ID and save, it syncs BACK to central repo
- Then commit in `my-workspace-tools` to share with team

---

**Quick Workflow:**
1. Get top 200 pages → 2. Run scraper → 3. Run audit with local data

