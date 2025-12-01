# Scraper - Local Testing Guide

## Quick Start

```bash
cd ~/Documents/my-workspace-tools
./run-scraper.sh
```

## What It Does

1. Prompts for **Site ID** (or uses current from `local.js`)
2. **Automatically patches** `abstract-handler.js` to remove hardcoded Chromium path
   - Removes the `executablePath: '/opt/homebrew/bin/chromium'` line
   - This fixes it for all handlers (DefaultHandler, etc.) since they inherit from abstract-handler
   - Restores the file after scraping completes
3. Runs the scraper locally
4. Saves scraped data to:
   ```
   ~/Documents/GitHub/SPACECAT/spacecat-content-scraper/tmp/scrapes/<SITE_ID>/
   ```

## Requirements

The scraper needs **top 200 pages data first**. Run this before scraping:

```bash
./get-top-pages.sh
```

This fetches the list of pages to scrape.

## Configuration

Edit the scraper's `local.js` file to configure:
- `SITE_ID` - Which site to scrape
- `BASE_URL` - Base URL of the site
- Other scraper options

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
cd ~/Documents/my-workspace-tools
./run-audit-worker.sh
# Select: true (use local data)
# Select: meta-tags (or other multi-step audit)
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
- ✅ Patches `abstract-handler.js` before running
- ✅ Restores `abstract-handler.js` after completion
- ✅ Keeps git status clean (no uncommitted changes)

Even if you Ctrl+C or the script errors, the file is restored automatically.

### Why Patch abstract-handler.js?
- It's the base class for most handlers (DefaultHandler, etc.)
- Patching it once fixes the issue for all inherited handlers
- `prerender-handler.js` overrides `getBrowser()` so it's not affected by this patch

## Troubleshooting

### "No top 200 pages found"
Run the top 200 pages script first:
```bash
./get-top-pages.sh
```

### Site ID mismatch in audit
Make sure the scraper's SITE_ID matches what you use in `run-audit-worker.sh`.

### Chromium not found
The script automatically removes the hardcoded Chromium path so Puppeteer uses its bundled version. No manual editing needed!

---

**Quick Workflow:**
1. Get top 200 pages → 2. Run scraper → 3. Run audit with local data

