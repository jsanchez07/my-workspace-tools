# Top 200 Pages - Local Testing Guide

## Quick Start

```bash
cd ~/Documents/GitHub/SPACECAT/my-workspace-tools
./get-top-pages.sh
```

## What It Does

Fetches the top 200 pages for a site from the SpaceCat API and saves them to `urls-to-scrape.txt` for the scraper to use.

## Requirements

1. **SpaceCat API Key** 
   - Stored in `spacecat-config.sh` (set during setup)
   - Or you'll be prompted to enter it

2. **Site ID** - You'll be prompted to enter it

## Output

Saves the top 200 pages to:
```
~/Documents/GitHub/SPACECAT/my-workspace-tools/local-data/urls-to-scrape.txt
```

This file is used by:
- `run-scraper.sh` - to know which URLs to scrape
- `canonical` and `hreflang` audits - as the list of URLs to validate
- Other audits - as the list of alternative URLs for suggestions

## Usage Flow

```bash
# 1. Get top 200 pages
./get-top-pages.sh

# 2. Run scraper (uses the URLs from urls-to-scrape.txt)
./run-scraper.sh

# 3. Run audit with scraped data
./run-audit-worker.sh
```

## Output Format

The `local-data/urls-to-scrape.txt` file contains one URL per line:
```
https://example.com/page1
https://example.com/page2
https://example.com/page3
...
```

## Manual Editing

You can manually edit `local-data/urls-to-scrape.txt` to:
- Add more URLs
- Remove URLs you don't want to scrape
- Add comments (lines starting with `#` are ignored)

Example:
```
# Top pages for example.com
https://example.com/
https://example.com/about
# https://example.com/skip-this  (commented out)
```

## Troubleshooting

### "Failed to fetch pages"
- Check your API key is correct in `spacecat-config.sh`
- Verify Site ID is correct (use the UUID from SpaceCat)
- Check network connectivity

### "API key not found"
The script will prompt you to enter it. You can also set it in `spacecat-config.sh`:
```bash
export SPACECAT_API_KEY="your-key-here"
```

### Get API Key
You can get your SpaceCat API key from the SpaceCat dashboard or ask your team lead.

---

**This is step 1** of the 3-step workflow:
1. **Top 200 pages** → 2. Scraper → 3. Audit worker

