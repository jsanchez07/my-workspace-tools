# SpaceCat Local Testing Tools

Quick reference for running SpaceCat audits and scraping locally.

## 📚 Documentation

- **[README-AUDIT-WORKER.md](README-AUDIT-WORKER.md)** - Run audits locally
- **[README-SCRAPER.md](README-SCRAPER.md)** - Run scraper locally  
- **[README-TOP-200-PAGES.md](README-TOP-200-PAGES.md)** - Fetch top 200 pages

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

### Fetch RUM Data (for broken-internal-links audit)
```bash
./fetch-broken-links.sh     # Fetch broken links from RUM API
```

### Utilities
```bash
./open-scrape-results.sh    # View scraped data in browser
```

### File Sync (Automatic!)
No manual commands needed! The scripts automatically:
- 📥 Sync latest files FROM central repo before running
- 📤 Sync changes BACK to central repo when you save

## 📋 Complete Workflow

### For Most Audits (using local scraper data)
```bash
# 1. Get top pages → scrape → audit
./get-top-pages.sh
./run-scraper.sh
./run-audit-worker.sh
```

### For Broken Internal Links Audit
```bash
# 1. Fetch broken links from RUM
./fetch-broken-links.sh     # Requires RUM domain key

# 2. Run the audit
./run-audit-worker.sh       # Select: broken-internal-links
```

**Note:** AWS credentials are **NOT required** for local testing. All AWS services (DynamoDB, S3, SQS) are mocked locally.

## ⚙️ Setup & Configuration

### First Time Setup (New Team Members)

After cloning this repo:

```bash
./setup-spacecat-tools.sh    # Configure YOUR repository paths
```

This creates `spacecat-config.sh` with your local paths. This file is **not tracked in git** - each developer has their own.

**Already set up?** Skip this step - your `spacecat-config.sh` already exists!

### Configuration Files

**Tracked in Git (shared with team):**
- **`index-local.js`** - Master copy for audit worker
- **`local.js`** - Master copy for scraper
- **`spacecat-config.sh.example`** - Template for config (reference only)

**NOT Tracked (user-specific, auto-generated):**
- **`spacecat-config.sh`** - Your personal paths (created by setup script)
- **`local-data/`** - Generated test data (see `local-data/README.md`)
  - `urls-to-scrape.txt` - URLs for audits
  - `broken-links-*.json` - RUM broken links data
  - `broken-links-*.txt` - Human-readable output

### Shell Functions (Optional)

For convenience, you can add these functions to your shell:

```bash
# Add to ~/.zshrc or ~/.bashrc
source ~/Documents/GitHub/SPACECAT/my-workspace-tools/spacecat-functions.sh
```

Available functions:
- `spacecat-load-perms` - Load AWS creds from env.sh
- `spacecat-run-audit` - Build and run audit worker
- `spacecat-check-creds` - Check if AWS creds loaded
- `spacecat-help` - Show all available commands

To view your current paths: `cat spacecat-config.sh`  
To reconfigure: `./setup-spacecat-tools.sh`

## 🔄 Automatic File Sync System

This repo contains **master copies** of local testing files (`index-local.js`, `local.js`).

### How It Works

1. **Before running**: Scripts automatically sync latest files FROM central repo TO projects
2. **After running**: If you made changes and choose to save, they sync BACK to central repo
3. **No manual syncing needed!** Everything is automatic

### What Gets Synced

| Central Repo (tracked in git) | Syncs To | When |
|-------------------------------|----------|------|
| `index-local.js` | `audit-worker/src/index-local.js` | Before/after audit runs |
| `local.js` | `scraper/local.js` | Before/after scraper runs |

### Making Changes

Just edit files here in `my-workspace-tools`, then run the scripts. Changes are automatically synced!

Or let the scripts modify the files (via prompts), then save changes back to central repo when asked.

---

**For detailed instructions, see the individual README files above.**

