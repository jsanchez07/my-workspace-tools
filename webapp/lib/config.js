const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOOLS_DIR = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(TOOLS_DIR, 'spacecat-config.sh');
const LAST_RUN_FILE = path.join(TOOLS_DIR, '.last-run-config.json');

/**
 * Parses spacecat-config.sh and returns key paths as an object.
 */
function readSpacecatConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      configured: false,
      toolsDir: TOOLS_DIR,
      scraperDir: '',
      auditWorkerDir: '',
      scraperTmpDir: '',
    };
  }

  const content = fs.readFileSync(CONFIG_FILE, 'utf8');
  const extract = (key) => {
    const match = content.match(new RegExp(`export\\s+${key}="([^"]+)"`));
    return match ? match[1] : '';
  };

  return {
    configured: true,
    toolsDir: extract('SPACECAT_TOOLS_DIR') || TOOLS_DIR,
    scraperDir: extract('SPACECAT_SCRAPER_DIR'),
    auditWorkerDir: extract('SPACECAT_AUDIT_WORKER_DIR'),
    scraperTmpDir: extract('SPACECAT_SCRAPER_TMP_DIR'),
    apiKeyStage: extract('SPACECAT_API_KEY_STAGE'),
    apiKeyProd: extract('SPACECAT_API_KEY_PROD'),
  };
}

/**
 * Reads last-run settings (.last-run-config.json).
 */
function readLastRun() {
  if (!fs.existsSync(LAST_RUN_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Writes a value to .last-run-config.json using dot-notation key.
 * e.g. writeLastRun('audit.lastSiteId', 'uuid...')
 */
function writeLastRun(dotKey, value) {
  const config = readLastRun();
  const parts = dotKey.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(config, null, 2));
}

/**
 * Checks which scraper data directories exist for a given siteId.
 */
function getScraperDataStatus(config, siteId) {
  if (!siteId || !config.scraperTmpDir) return { exists: false, count: 0 };
  const dir = path.join(config.scraperTmpDir, 'scrapes', siteId);
  if (!fs.existsSync(dir)) return { exists: false, count: 0 };
  try {
    const files = fs.readdirSync(dir);
    return { exists: true, count: files.length, dir };
  } catch {
    return { exists: false, count: 0 };
  }
}

/**
 * Checks whether local-data files exist for a siteId.
 */
function getLocalDataStatus(config, siteId) {
  const urlsFile = path.join(TOOLS_DIR, 'local-data', 'urls-to-scrape.txt');
  const brokenLinksFile = siteId
    ? path.join(TOOLS_DIR, 'local-data', `broken-links-${siteId}.json`)
    : null;

  return {
    urlsFile: fs.existsSync(urlsFile) ? urlsFile : null,
    brokenLinksFile: brokenLinksFile && fs.existsSync(brokenLinksFile) ? brokenLinksFile : null,
  };
}

/**
 * Checks git status for a file in the audit worker to detect uncommitted changes.
 * Returns true if the file has local changes.
 */
function hasLocalChanges(auditWorkerDir, relPath) {
  try {
    const result = execSync(
      `git diff --name-only HEAD -- "${relPath}"`,
      { cwd: auditWorkerDir, stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Returns git diff output for a file (for display in UI).
 */
function getFileDiff(auditWorkerDir, relPath) {
  try {
    return execSync(
      `git diff HEAD -- "${relPath}"`,
      { cwd: auditWorkerDir, stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString();
  } catch {
    return '';
  }
}

module.exports = {
  TOOLS_DIR,
  readSpacecatConfig,
  readLastRun,
  writeLastRun,
  getScraperDataStatus,
  getLocalDataStatus,
  hasLocalChanges,
  getFileDiff,
};
