const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');

const {
  readSpacecatConfig, readLastRun, writeLastRun,
  getScraperDataStatus, getLocalDataStatus, checkLocalChanges: checkChanges,
  TOOLS_DIR,
} = require('./lib/config.js');
const { getServicesStatus } = require('./lib/services.js');
const { FLOWS } = require('./lib/audit-flows.js');
const {
  applyPatches, restoreAll, checkLocalChanges,
  writeBrokenBacklinksMock, removeBrokenBacklinksMock, hasBrokenBacklinksMock,
} = require('./lib/patcher.js');
const { startJob, streamJob, killJob, getJobStatus, getJobBuffer } = require('./lib/runner.js');

const app = express();
const PORT = process.env.PORT || 3333;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Startup: restore any leftover patches from a previous crashed run ────────
// If the server was killed while a job was running, backup files may remain.
// Restore them now so the repo is clean before accepting any new runs.
(function restoreLeftoverPatches() {
  const config = readSpacecatConfig();
  if (!config.auditWorkerDir) return;
  try {
    // Check for .local-dev-backup files directly — this is the authoritative signal
    // that patches were applied but not cleaned up (e.g. server was force-killed).
    const { PATCH_TARGETS } = require('./lib/patcher.js');
    const leftover = PATCH_TARGETS.filter((f) => fs.existsSync(
      path.join(config.auditWorkerDir, `${f}.local-dev-backup`),
    ));
    if (leftover.length > 0) {
      console.log(`[startup] Found ${leftover.length} leftover backup(s) — restoring patched files...`);
      restoreAll(config.auditWorkerDir);
      console.log('[startup] Patches restored.');
    }
  } catch (err) {
    console.error('[startup] Failed to restore patches on startup:', err.message);
  }
}());

// ─── AWS Credentials (in-memory, session-only) ───────────────────────────────

const AWS_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_DEFAULT_REGION'];
let awsCredentials = {};

/**
 * POST /api/credentials
 * Accepts pasted credentials in any common format:
 *   export AWS_ACCESS_KEY_ID="ASIA..."
 *   AWS_ACCESS_KEY_ID=ASIA...
 *   set AWS_ACCESS_KEY_ID=ASIA...   (Windows style)
 */
app.post('/api/credentials', (req, res) => {
  const { raw } = req.body;
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'raw field required' });

  const parsed = {};
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^(?:export\s+|set\s+)?([A-Za-z_]+)\s*=\s*"?([^"]+)"?$/);
    if (m) {
      const key = m[1].toUpperCase();
      if (AWS_KEYS.includes(key)) parsed[key] = m[2].trim();
    }
  }

  if (Object.keys(parsed).length === 0) {
    return res.status(400).json({ error: 'No AWS credential keys found. Expected AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN.' });
  }

  awsCredentials = { ...awsCredentials, ...parsed };
  res.json({ ok: true, keys: Object.keys(awsCredentials) });
});

app.delete('/api/credentials', (req, res) => {
  awsCredentials = {};
  res.json({ ok: true });
});

app.get('/api/credentials/status', (req, res) => {
  res.json({ keys: Object.keys(awsCredentials) });
});

// ─── Config ──────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const config = readSpacecatConfig();
  const lastRun = readLastRun();
  res.json({ config, lastRun });
});

// ─── Audit flows ─────────────────────────────────────────────────────────────

app.get('/api/audit-flows', (req, res) => {
  res.json(FLOWS);
});

// ─── Services status ─────────────────────────────────────────────────────────

app.get('/api/services', async (req, res) => {
  const config = readSpacecatConfig();

  // Try to find mystique and api-service dirs from common paths
  const base = path.dirname(config.auditWorkerDir || TOOLS_DIR);
  const mystiqueDir = path.join(base, 'mystique');
  const apiServiceDir = path.join(base, 'spacecat-api-service');

  const services = await getServicesStatus({
    mystiqueDir: fs.existsSync(mystiqueDir) ? mystiqueDir : null,
    apiServiceDir: fs.existsSync(apiServiceDir) ? apiServiceDir : null,
  });

  res.json(services);
});

// ─── Local data / pre-run checks ─────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const { siteId } = req.query;
  const config = readSpacecatConfig();

  const scraperData = getScraperDataStatus(config, siteId);
  const localData = getLocalDataStatus(config, siteId);

  let localChangesWarning = [];
  if (config.auditWorkerDir) {
    localChangesWarning = checkLocalChanges(config.auditWorkerDir)
      .filter((f) => f.exists && f.changed);
  }

  res.json({ scraperData, localData, localChangesWarning });
});

// ─── Run: Scraper ─────────────────────────────────────────────────────────────

app.post('/api/run/scraper', (req, res) => {
  const config = readSpacecatConfig();
  if (!config.configured) return res.status(400).json({ error: 'Not configured. Run setup first.' });

  const { siteId, urls } = req.body;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  // Write URLs file if provided
  if (urls && Array.isArray(urls) && urls.length > 0) {
    const urlsFile = path.join(TOOLS_DIR, 'local-data', 'urls-to-scrape.txt');
    fs.mkdirSync(path.dirname(urlsFile), { recursive: true });
    fs.writeFileSync(urlsFile, urls.join('\n') + '\n');
  }

  // Write last-run site ID
  writeLastRun('scraper.lastSiteId', siteId);

  // Run the scraper shell script non-interactively by passing env vars
  const jobId = startJob('bash', ['run-scraper.sh'], TOOLS_DIR, {
    ...awsCredentials,
    SITE_ID: siteId,
    NON_INTERACTIVE: 'true',
  });

  res.json({ jobId });
});

// ─── Run: Audit ───────────────────────────────────────────────────────────────

app.post('/api/run/audit', (req, res) => {
  const config = readSpacecatConfig();
  if (!config.configured) return res.status(400).json({ error: 'Not configured. Run setup first.' });
  if (!config.auditWorkerDir) return res.status(400).json({ error: 'Audit worker directory not configured.' });

  const {
    auditType,
    siteId,
    baseUrl,
    useLocalScraperData = false,
    useLocalTopPages = false,
  } = req.body;

  if (!auditType) return res.status(400).json({ error: 'auditType is required' });
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  const flow = FLOWS[auditType];
  const isMultiStep = flow
    ? !!(flow.isMultiStep || (flow.steps.some((s) => s.id === 'fetch-rum') && flow.steps.some((s) => s.id === 'audit')))
    : false;

  const topPagesFile = path.join(TOOLS_DIR, 'local-data', 'urls-to-scrape.txt');

  try {
    applyPatches(config.auditWorkerDir, {
      auditType,
      siteId,
      baseUrl: baseUrl || '',
      useLocalScraperData: !!useLocalScraperData,
      useLocalTopPages: !!useLocalTopPages,
      topPagesFile,
      isMultiStep,
    });
  } catch (err) {
    return res.status(500).json({ error: `Patch failed: ${err.message}` });
  }

  writeLastRun('audit.lastAuditType', auditType);
  writeLastRun('audit.lastSiteId', siteId);
  writeLastRun('audit.lastBaseUrl', baseUrl || '');
  writeLastRun('audit.lastUseLocalData', String(useLocalScraperData));

  // Run the audit worker shell script — non-interactively
  const jobId = startJob(
    'bash',
    ['run-audit-worker.sh'],
    TOOLS_DIR,
    {
      ...awsCredentials,
      AUDIT_TYPE: auditType,
      SITE_ID: siteId,
      BASE_URL: baseUrl || '',
      USE_LOCAL: useLocalScraperData ? 'true' : 'false',
      NON_INTERACTIVE: 'true',
      SKIP_PATCH: 'true', // Signal to shell script that patching is already done by webapp
    },
    () => {
      // Restore patches as soon as the process exits
      try {
        restoreAll(config.auditWorkerDir);
      } catch (err) {
        console.error('Failed to restore patches:', err.message);
      }
    },
  );

  res.json({ jobId });
});

// ─── Run: Fetch top pages ─────────────────────────────────────────────────────

app.post('/api/run/top-pages', (req, res) => {
  const { siteId, environment } = req.body;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  const isProd = environment === 'prod';
  const config = readSpacecatConfig();
  const key = isProd ? config.apiKeyProd : config.apiKeyStage;
  if (!key) return res.status(400).json({ error: `No API key found for ${isProd ? 'prod' : 'stage'} in spacecat-config.sh` });

  const apiUrl = isProd
    ? 'https://spacecat.experiencecloud.live/api/v1/sites'
    : 'https://spacecat.experiencecloud.live/api/ci/sites';

  const jobId = startJob('bash', ['get-top-pages.sh'], TOOLS_DIR, {
    SITE_ID: siteId,
    SPACECAT_API_KEY: key,
    SPACECAT_API_URL: apiUrl,
    NON_INTERACTIVE: 'true',
  });

  res.json({ jobId });
});

// ─── Save top pages list from paste ──────────────────────────────────────────

/**
 * POST /api/save-top-pages
 * Saves a manually pasted URL list to local-data/urls-to-scrape.txt.
 */
app.post('/api/save-top-pages', (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array is required' });
  }
  const urlsFile = path.join(TOOLS_DIR, 'local-data', 'urls-to-scrape.txt');
  fs.mkdirSync(path.dirname(urlsFile), { recursive: true });
  fs.writeFileSync(urlsFile, urls.join('\n') + '\n');
  res.json({ ok: true, count: urls.length });
});

// ─── Fetch broken backlinks from SpaceCat API (sync, returns JSON for preview) ──

/**
 * POST /api/fetch-backlinks-preview
 * Fetches broken-backlinks opportunities + suggestions from the SpaceCat API
 * and returns the raw backlinks array for the client to display / edit before importing.
 * Uses the same x-api-key from spacecat-config.sh (stage or prod based on environment).
 */
app.post('/api/fetch-backlinks-preview', async (req, res) => {
  const { siteId, environment } = req.body;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  const isProd = environment === 'prod';
  const config = readSpacecatConfig();
  const apiKey = isProd ? config.apiKeyProd : config.apiKeyStage;
  if (!apiKey) return res.status(400).json({ error: `No API key found for ${isProd ? 'prod' : 'stage'} in spacecat-config.sh` });

  const apiBase = isProd
    ? 'https://spacecat.experiencecloud.live/api/v1/'
    : 'https://spacecat.experiencecloud.live/api/ci/';

  const headers = { 'x-api-key': apiKey };
  const EXCLUDED = new Set(['OUTDATED', 'FIXED', 'REJECTED', 'SKIPPED']);

  try {
    const oppsRes = await fetch(`${apiBase}sites/${siteId}/opportunities`, { headers });
    if (!oppsRes.ok) {
      const text = await oppsRes.text().catch(() => '');
      return res.status(oppsRes.status).json({ error: `API returned ${oppsRes.status}${text ? `: ${text.slice(0, 200)}` : ''}` });
    }

    const allOpps = await oppsRes.json();
    const opps = allOpps.filter((o) => o.type === 'broken-backlinks');

    const backlinks = [];
    for (const opp of opps) {
      const suggsRes = await fetch(`${apiBase}sites/${siteId}/opportunities/${opp.id}/suggestions`, { headers });
      if (!suggsRes.ok) continue;
      const suggestions = await suggsRes.json();
      for (const s of suggestions.filter((s) => !EXCLUDED.has(s.status))) {
        backlinks.push({
          url_from: s.data?.url_from ?? '',
          url_to: s.data?.url_to ?? '',
          traffic_domain: s.data?.traffic_domain ?? 0,
          title: s.data?.title ?? '',
        });
      }
    }

    res.json({ count: backlinks.length, backlinks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Run: Fetch broken links (Step 1 for broken-internal-links) ───────────────

app.post('/api/run/fetch-broken-links', (req, res) => {
  const { siteId, baseUrl, rumDomainKey } = req.body;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  if (!rumDomainKey) return res.status(400).json({ error: 'RUM domain key is required' });

  const jobId = startJob('bash', ['fetch-broken-links.sh'], TOOLS_DIR, {
    SITE_ID: siteId,
    BASE_URL: baseUrl || '',
    RUM_DOMAIN_KEY: rumDomainKey,
    NON_INTERACTIVE: 'true',
  });

  res.json({ jobId });
});

// ─── Job streaming & management ───────────────────────────────────────────────

app.get('/api/stream/:jobId', (req, res) => {
  streamJob(req.params.jobId, res);
});

app.get('/api/jobs', (req, res) => {
  const { listJobs } = require('./lib/runner.js');
  res.json(listJobs());
});

app.get('/api/jobs/:jobId', (req, res) => {
  const status = getJobStatus(req.params.jobId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

app.delete('/api/jobs/:jobId', (req, res) => {
  killJob(req.params.jobId);
  // Restore patches immediately — don't wait for process close event
  // (SIGTERM to bash doesn't propagate to Docker grandchildren, so close may never fire)
  const config = readSpacecatConfig();
  if (config.auditWorkerDir) {
    try {
      restoreAll(config.auditWorkerDir);
    } catch (err) {
      console.error('Failed to restore patches on kill:', err.message);
    }
  }
  res.json({ ok: true });
});

// ─── Broken-backlinks mock data ───────────────────────────────────────────────

/**
 * POST /api/import/broken-backlinks
 * Accepts pasted data (CSV rows, TSV, or JSON) and saves it as
 * broken-backlinks-local.json in the audit worker directory.
 *
 * Accepted formats (auto-detected):
 *   1. SpaceCat UI block format — entries separated by "NEW":
 *        url_from
 *        page title
 *        rank number
 *        url_to
 *        suggestion URLs (ignored)
 *        rationale text (ignored)
 *   2. JSON array:  [{ url_from, url_to, traffic_domain, title }, …]
 *   3. JSON object: { backlinks: […] }
 *   4. CSV/TSV with headers — any combo of:
 *        Referring domain and page | url_from | Referring Page
 *        Broken target URL         | url_to   | Broken URL
 *        Priority                  | rank     | traffic_domain
 *        Suggestion                | (ignored for mock data)
 *   5. Two bare URLs per line: "<url_from>\t<url_to>" or "<url_from>,<url_to>"
 *
 * Priority mapping (when no numeric rank is available):
 *   High → 80, Medium → 50, Low → 20, (default) → 50
 */
app.post('/api/import/broken-backlinks', (req, res) => {
  const config = readSpacecatConfig();
  if (!config.auditWorkerDir) {
    return res.status(400).json({ error: 'Audit worker directory not configured.' });
  }

  const { raw } = req.body;
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return res.status(400).json({ error: 'raw field is required' });
  }

  const priorityToRank = { high: 80, medium: 50, low: 20 };

  let backlinks = [];

  try {
    // ── Try JSON first ──────────────────────────────────────────────────────
    const trimmed = raw.trim();

    // ── SpaceCat UI block format (entries separated by "NEW") ───────────────
    // Each block:
    //   url_from
    //   page title (plain text)
    //   rank number
    //   url_to  (the broken URL)
    //   suggestion URLs... (ignored — mock data only needs url_from/url_to/rank)
    //   rationale text (ignored)
    if (/^NEW$/m.test(trimmed)) {
      const isUrl = (s) => /^https?:\/\//i.test(s);
      const blocks = trimmed.split(/\n\s*NEW\s*\n/).map((b) => b.trim()).filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        let url_from = '';
        let traffic_domain = 50;
        let url_to = '';
        let state = 'want_from';
        for (const line of lines) {
          if (state === 'want_from') {
            if (isUrl(line)) { url_from = line; state = 'want_rank'; }
          } else if (state === 'want_rank') {
            if (/^\d+$/.test(line)) { traffic_domain = Number(line); state = 'want_to'; }
            // skip title line (non-URL, non-number)
          } else if (state === 'want_to') {
            if (isUrl(line)) { url_to = line; break; }
          }
        }
        if (url_from && url_to) {
          backlinks.push({ url_from, url_to, traffic_domain, title: '' });
        }
      }
    } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : (parsed.backlinks || []);
      backlinks = arr.map((row) => ({
        url_from: (row.url_from || row.referring_page || '').trim(),
        url_to: (row.url_to || row.broken_url || row.broken_target_url || '').trim(),
        traffic_domain: Number(row.traffic_domain ?? row.rank ?? 50),
        title: (row.title || '').trim(),
      })).filter((r) => r.url_from && r.url_to);
    } else {
      // ── CSV / TSV parsing ─────────────────────────────────────────────────
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
      const sep = lines[0].includes('\t') ? '\t' : ',';

      const splitLine = (line) => {
        if (sep === ',') {
          // Handle quoted CSV fields
          const result = [];
          let cur = '';
          let inQuote = false;
          for (const ch of line) {
            if (ch === '"') { inQuote = !inQuote; }
            else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
            else { cur += ch; }
          }
          result.push(cur.trim());
          return result;
        }
        return line.split('\t').map((c) => c.trim());
      };

      const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));

      const colIndex = (candidates) => {
        for (const c of candidates) {
          const idx = headers.findIndex((h) => h.includes(c));
          if (idx >= 0) return idx;
        }
        return -1;
      };

      const fromIdx  = colIndex(['url_from', 'referring', 'from']);
      const toIdx    = colIndex(['url_to', 'broken_target', 'broken_url', 'broken']);
      const rankIdx  = colIndex(['traffic_domain', 'rank', 'priority']);

      const hasHeaders = fromIdx >= 0 && toIdx >= 0;
      const dataLines = hasHeaders ? lines.slice(1) : lines;

      for (const line of dataLines) {
        const cols = splitLine(line);
        let url_from, url_to, traffic_domain = 50;

        if (hasHeaders) {
          url_from = (cols[fromIdx] || '').trim();
          url_to   = (cols[toIdx] || '').trim();
          if (rankIdx >= 0) {
            const rankVal = (cols[rankIdx] || '').trim().toLowerCase();
            traffic_domain = priorityToRank[rankVal] ?? (Number(rankVal) || 50);
          }
        } else {
          // Bare two-URL lines
          url_from = (cols[0] || '').trim();
          url_to   = (cols[1] || '').trim();
          if (cols[2]) {
            const rv = cols[2].toLowerCase();
            traffic_domain = priorityToRank[rv] ?? (Number(rv) || 50);
          }
        }

        if (url_from && url_to) {
          backlinks.push({ url_from, url_to, traffic_domain, title: '' });
        }
      }
    }
  } catch (err) {
    return res.status(400).json({ error: `Parse error: ${err.message}` });
  }

  if (backlinks.length === 0) {
    return res.status(400).json({ error: 'No valid rows found. Check format.' });
  }

  writeBrokenBacklinksMock(config.auditWorkerDir, backlinks);
  res.json({ ok: true, count: backlinks.length });
});

/**
 * GET /api/import/broken-backlinks
 * Returns the currently loaded backlink rows so the client can show them for editing.
 */
app.get('/api/import/broken-backlinks', (req, res) => {
  const config = readSpacecatConfig();
  if (!config.auditWorkerDir || !hasBrokenBacklinksMock(config.auditWorkerDir)) {
    return res.json({ backlinks: [] });
  }
  try {
    const mockPath = path.join(config.auditWorkerDir, 'broken-backlinks-local.json');
    const data = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
    res.json({ backlinks: data.backlinks ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/import/broken-backlinks
 * Removes the loaded data file so the next run calls Semrush.
 */
app.delete('/api/import/broken-backlinks', (req, res) => {
  const config = readSpacecatConfig();
  if (config.auditWorkerDir) removeBrokenBacklinksMock(config.auditWorkerDir);
  res.json({ ok: true });
});

/**
 * GET /api/import/broken-backlinks/status
 * Returns whether mock data is currently loaded.
 */
app.get('/api/import/broken-backlinks/status', (req, res) => {
  const config = readSpacecatConfig();
  const active = hasBrokenBacklinksMock(config.auditWorkerDir);
  let count = 0;
  if (active && config.auditWorkerDir) {
    try {
      const mockPath = require('path').join(config.auditWorkerDir, 'broken-backlinks-local.json');
      const data = JSON.parse(require('fs').readFileSync(mockPath, 'utf8'));
      count = data.backlinks?.length ?? 0;
    } catch { /* ignore */ }
  }
  res.json({ active, count });
});

// ─── Local changes check ──────────────────────────────────────────────────────

app.get('/api/local-changes', (req, res) => {
  const config = readSpacecatConfig();
  if (!config.auditWorkerDir) return res.json([]);
  const changes = checkLocalChanges(config.auditWorkerDir);
  res.json(changes);
});

// ─── Results: job buffer ──────────────────────────────────────────────────────

/**
 * GET /api/results/job/:jobId
 * Returns the stdout/stderr lines for a completed job, for client-side parsing.
 */
app.get('/api/results/job/:jobId', (req, res) => {
  const data = getJobBuffer(req.params.jobId);
  if (!data) return res.status(404).json({ error: 'Job not found' });
  const lines = data.buffer
    .filter((l) => l.type === 'stdout' || l.type === 'stderr')
    .map((l) => l.text);
  res.json({ lines, status: data.status });
});

// ─── Results: Mystique SQS peek ───────────────────────────────────────────────

/**
 * GET /api/results/mystique
 * Peeks at the mystique-to-spacecat Localstack queue without consuming messages
 * (VisibilityTimeout=0 so they remain available).
 * Returns { messages: [...payload objects], error? }
 */
app.get('/api/results/mystique', async (req, res) => {
  const body = [
    'Action=ReceiveMessage',
    'MaxNumberOfMessages=10',
    'VisibilityTimeout=0',
    'WaitTimeSeconds=0',
    'Version=2012-11-05',
  ].join('&');

  try {
    const xml = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 4566,
        path: '/000000000000/mystique-to-spacecat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          // Localstack accepts any auth header
          Authorization: 'AWS4-HMAC-SHA256 Credential=localstack/20240101/us-east-1/sqs/aws4_request, SignedHeaders=host, Signature=localstack',
        },
        timeout: 5000,
      };
      const r = http.request(options, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => resolve(data));
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Localstack connection timed out')); });
      r.write(body);
      r.end();
    });

    // Extract <Body> elements from the SQS XML response.
    // Body content is JSON — it won't contain </Body> so regex is safe.
    const messages = [];
    for (const match of xml.matchAll(/<Body>([\s\S]*?)<\/Body>/g)) {
      try {
        const decoded = match[1]
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&apos;/g, "'");
        messages.push(JSON.parse(decoded));
      } catch { /* skip malformed entries */ }
    }

    res.json({ messages });
  } catch (err) {
    res.json({ messages: [], error: err.message });
  }
});

// ─── Restart Mystique ─────────────────────────────────────────────────────────

/**
 * POST /api/services/restart-mystique
 * Kills any process on port 8080, then starts Mystique via run-server.sh.
 * Polls until port 8080 is open, then returns.
 */
const MYSTIQUE_LOG_FILE = path.join(require('os').tmpdir(), 'spacecat-mystique-restart.log');

app.post('/api/services/restart-mystique', (req, res) => {
  const config = readSpacecatConfig();
  const base = path.dirname(config.auditWorkerDir || TOOLS_DIR);
  const mystiqueDir = path.join(base, 'mystique');

  if (!fs.existsSync(mystiqueDir)) {
    return res.status(400).json({ error: `Mystique directory not found: ${mystiqueDir}` });
  }

  const { execSync, spawn } = require('child_process');

  // Kill any existing process on port 8080
  try {
    execSync('lsof -ti:8080 | xargs kill -9 2>/dev/null; true', { stdio: 'pipe', shell: '/bin/bash' });
  } catch { /* no process to kill */ }

  // Truncate the log file so the client starts fresh
  try { fs.writeFileSync(MYSTIQUE_LOG_FILE, ''); } catch { /* ignore */ }

  res.json({ ok: true });

  // Spawn after a brief delay so the port has time to clear.
  // Use a login shell (-l) + source ~/.zshrc so conda/pyenv/PATH are loaded.
  // Redirect all output to a log file the client can poll.
  setTimeout(() => {
    const child = spawn('/bin/zsh', [
      '-l', '-c',
      `source ~/.zshrc 2>/dev/null; cd "${mystiqueDir}" && ./run-server.sh --with-localstack >> "${MYSTIQUE_LOG_FILE}" 2>&1`,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 1200);
});

// Lightweight port check — avoids probing all services just to check Mystique
app.get('/api/services/check-mystique', async (req, res) => {
  const { checkPort } = require('./lib/services.js');
  res.json({ running: await checkPort(8080) });
});

// Stream Mystique restart log to the client (polled, not SSE)
app.get('/api/services/mystique-log', (req, res) => {
  const offset = parseInt(req.query.offset ?? '0', 10);
  try {
    const content = fs.readFileSync(MYSTIQUE_LOG_FILE, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    res.json({ lines: lines.slice(offset), total: lines.length });
  } catch {
    res.json({ lines: [], total: 0 });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅ SpaceCat Local Dev running at http://localhost:${PORT}\n`);
});
