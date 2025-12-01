# Top 200 Pages - Local Testing Guide

## Quick Start

```bash
cd ~/Documents/my-workspace-tools
./get-top-pages.sh
```

## What It Does

Fetches the top 200 pages for a site from the SpaceCat API and saves them locally for the scraper to use.

## Requirements

1. **AWS Credentials** (for API access)
   ```bash
   $(curl -s 'https://klam.corp.adobe.com/pastebin/?id=YOUR_ID_HERE')
   ```

2. **Site ID** - You'll be prompted to enter it

## Output

Saves the top 200 pages list to a file that the scraper uses.

## Usage Flow

```bash
# 1. Get top 200 pages
./get-top-pages.sh

# 2. Run scraper (uses the top 200 list)
./run-scraper.sh

# 3. Run audit with scraped data
./run-audit-worker.sh
```

## Troubleshooting

### "Failed to fetch pages"
- Check AWS credentials are loaded
- Verify Site ID is correct
- Check API endpoint is accessible

---

**This is step 1** of the 3-step workflow:
1. **Top 200 pages** → 2. Scraper → 3. Audit worker

