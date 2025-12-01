# SpaceCat Local Testing Tools

Quick reference for running SpaceCat audits and scraping locally.

## 📚 Documentation

- **[AUDIT_WORKER.md](AUDIT_WORKER.md)** - Run audits locally
- **[SCRAPER.md](SCRAPER.md)** - Run scraper locally  
- **[TOP_200_PAGES.md](TOP_200_PAGES.md)** - Fetch top 200 pages

## 🚀 Quick Commands

### Run an Audit
```bash
./run-audit-worker.sh      # Interactive - any audit type
```

### Run Scraper
```bash
./get-top-pages.sh          # 1. Get top 200 pages
./run-scraper.sh            # 2. Scrape pages
```

### Utilities
```bash
./open-scrape-results.sh    # View scraped data in browser
```

## 📋 Complete Workflow

```bash
# 1. Load AWS credentials
$(curl -s 'https://klam.corp.adobe.com/pastebin/?id=YOUR_ID_HERE')

# 2. Get top pages → scrape → audit
./get-top-pages.sh
./run-scraper.sh
./run-audit-worker.sh
```

## ⚙️ Setup & Configuration

### First Time Setup
```bash
./setup-spacecat-tools.sh    # Configure repository paths
```

This creates `spacecat-config.sh` with your repo locations.

### Configuration Files (Don't Delete!)
- **`setup-spacecat-tools.sh`** - Initial setup wizard
- **`spacecat-config.sh`** - Your repo paths (auto-generated)
- **`spacecat-functions.sh`** - Shared script functions

**Current paths in spacecat-config.sh:**
- Scraper: `/Users/jsanchez/Documents/GitHub/SPACECAT/spacecat-content-scraper`
- Audit Worker: `/Users/jsanchez/Documents/GitHub/SPACECAT/spacecat-audit-worker`
- Tools: `/Users/jsanchez/Documents/my-workspace-tools`

To reconfigure, run `./setup-spacecat-tools.sh` again.

---

**For detailed instructions, see the individual .md files above.**

