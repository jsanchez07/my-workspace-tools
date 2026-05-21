/**
 * Safe patching for local audit worker runs.
 *
 * The old shell script approach copies the master index-local.js from
 * my-workspace-tools into the audit worker, clobbering any local changes.
 *
 * This module takes the opposite approach:
 *   1. Never copy the master file. Always patch whatever is currently in the repo.
 *   2. Backup before patching. Restore on cleanup.
 *   3. Warn if a file to be patched has uncommitted changes (so the user knows).
 *
 * Files patched during an audit run:
 *   - src/index-local.js       (type, siteId, USE_LOCAL_SCRAPER_DATA, USE_LOCAL_TOP_PAGES)
 *   - src/common/step-audit.js (bypass enablement check, mock scrape paths, mock audit ID)
 *   - src/common/audit-utils.js (bypass isAuditEnabledForSite)
 *   - src/utils/getPresignedUrl.js (return mock S3 URLs)
 *   - src/metatags/metatags-auto-suggest.js (skip Genvar AI)
 *   - src/headings/handler.js (skip Azure OpenAI)
 *   - src/backlinks/handler.js (use local mock data instead of Semrush, when file present)
 *
 * Files written fresh (not patched):
 *   - local-config.json           (written, deleted after run)
 *   - broken-backlinks-local.json (written by import endpoint, deleted after run)
 *   - env.json                    (written, deleted after run)
 *   - template-local.yml          (written, deleted after run)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Files that get backup+patch+restore treatment.
// index-local.js is listed first so it's always patched/restored.
const PATCH_TARGETS = [
  'src/index-local.js',
  'src/common/step-audit.js',
  'src/common/audit-utils.js',
  'src/utils/getPresignedUrl.js',
  'src/metatags/metatags-auto-suggest.js',
  'src/headings/handler.js',
  'src/backlinks/handler.js',
];

/**
 * Returns git status for each patch target. Used to warn the user before patching.
 */
function checkLocalChanges(auditWorkerDir) {
  return PATCH_TARGETS.map((relPath) => {
    const fullPath = path.join(auditWorkerDir, relPath);
    if (!fs.existsSync(fullPath)) return { file: relPath, exists: false, changed: false };

    try {
      const out = execSync(
        `git diff --name-only HEAD -- "${relPath}"`,
        { cwd: auditWorkerDir, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const changed = out.length > 0;

      // Also check staged changes
      const staged = execSync(
        `git diff --cached --name-only -- "${relPath}"`,
        { cwd: auditWorkerDir, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();

      return { file: relPath, exists: true, changed: changed || staged.length > 0 };
    } catch {
      return { file: relPath, exists: true, changed: false };
    }
  });
}

/**
 * Backs up a file by copying it to <file>.local-dev-backup.
 * If a backup already exists it's overwritten (idempotent).
 */
function backupFile(fullPath) {
  if (fs.existsSync(fullPath)) {
    fs.copyFileSync(fullPath, `${fullPath}.local-dev-backup`);
  }
}

/**
 * Restores a file from its .local-dev-backup copy and removes the backup.
 */
function restoreFile(fullPath) {
  const backupPath = `${fullPath}.local-dev-backup`;
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, fullPath);
    fs.unlinkSync(backupPath);
  }
}

/**
 * Returns the name of the last .addStep() in a handler.js, or null if not found.
 * Used to set auditContext.next correctly when skipping to the final step.
 */
function detectFinalStep(auditWorkerDir, auditType) {
  const dirMap = {
    'lhs-mobile': 'lhs', 'lhs-desktop': 'lhs',
    'meta-tags': 'metatags', 'broken-backlinks': 'backlinks',
    'broken-internal-links': 'internal-links',
  };
  const auditDir = dirMap[auditType] || auditType;
  const handlerPath = path.join(auditWorkerDir, 'src', auditDir, 'handler.js');
  if (!fs.existsSync(handlerPath)) return null;
  const handlerContent = fs.readFileSync(handlerPath, 'utf8');
  const matches = handlerContent.match(/\.addStep\(\s*'([^']+)'/g);
  if (!matches || matches.length === 0) return null;
  const stepNames = matches.map((m) => m.match(/\.addStep\(\s*'([^']+)'/)[1]);
  return stepNames[stepNames.length - 1];
}

/**
 * Patches src/index-local.js in-place (on whatever the user has locally).
 * Only updates type, siteId, USE_LOCAL_SCRAPER_DATA. Does NOT copy the master file.
 */
function patchIndexLocal(auditWorkerDir, { auditType, siteId, useLocalScraperData, isMultiStep }) {
  const filePath = path.join(auditWorkerDir, 'src/index-local.js');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');

  // Hardcode AUDIT_TYPE and SITE_ID declarations so they are embedded directly in the
  // file and don't depend on process.env or --env-vars env.json being applied by SAM.
  // This handles both the env-var form:  const AUDIT_TYPE = process.env.AUDIT_TYPE || '...';
  // and any previously-patched hardcoded form: const AUDIT_TYPE = '...';
  content = content.replace(
    /const AUDIT_TYPE = .+;/,
    `const AUDIT_TYPE = '${auditType}';`,
  );
  content = content.replace(
    /const SITE_ID = .+;/,
    `const SITE_ID = '${siteId}';`,
  );

  // Update USE_LOCAL_SCRAPER_DATA constant (handles both true and false)
  content = content.replace(
    /const USE_LOCAL_SCRAPER_DATA = (true|false);/,
    `const USE_LOCAL_SCRAPER_DATA = ${useLocalScraperData};`,
  );

  // For multi-step audits, set auditId to the all-zeros mock UUID so step-audit.js
  // knows to use local data instead of querying the database.
  if (isMultiStep) {
    content = content.replace(
      /auditId: '[^']+',(\s*\/\/.*)?$/m,
      `auditId: '00000000-0000-0000-0000-000000000000', // LOCAL TEST MODE: mock audit ID`,
    );
    content = content.replace(
      /scrapeJobId: '[^']+',(\s*\/\/.*)?$/m,
      `scrapeJobId: '00000000-0000-0000-0000-000000000000', // LOCAL TEST MODE: mock scrape job`,
    );

    // Fix auditContext.next to point at the correct final step.
    // The new index-local.js format uses a backtick template literal:
    //   next: `check-${AUDIT_TYPE}`,
    // which is wrong for multi-step; we need the actual last step name.
    const finalStep = detectFinalStep(auditWorkerDir, auditType);
    if (finalStep) {
      // Replace both single-quote and backtick-template variants
      content = content.replace(
        /next:\s*(?:'[^']*'|`[^`]*`)/,
        `next: '${finalStep}'`,
      );
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Writes local-config.json into the audit worker directory.
 * This is the primary config mechanism — index-local.js reads it on startup.
 */
function writeLocalConfig(auditWorkerDir, {
  siteId, baseUrl, useLocalScraperData, useLocalTopPages, topPagesFile,
}) {
  const configPath = path.join(auditWorkerDir, 'local-config.json');
  const config = {
    siteId,
    baseUrl,
    USE_LOCAL_SCRAPER_DATA: useLocalScraperData,
    USE_LOCAL_TOP_PAGES: useLocalTopPages,
    TOP_PAGES_FILE: topPagesFile || '',
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Removes local-config.json from the audit worker directory.
 */
function removeLocalConfig(auditWorkerDir) {
  const configPath = path.join(auditWorkerDir, 'local-config.json');
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}

/**
 * Patches step-audit.js to bypass the audit enablement check and mock scrape paths.
 * This is the same logic as in run-audit-worker.sh.
 */
function patchStepAudit(auditWorkerDir, { isMultiStep, siteId, baseUrl } = {}) {
  const filePath = path.join(auditWorkerDir, 'src/common/step-audit.js');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');

  // Bypass isAuditEnabledForSite check
  const lines = content.split('\n');
  let inEnabledCheck = false;
  let braceDepth = 0;
  let patched = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inEnabledCheck && line.includes('isAuditEnabledForSite(type, site, context)')) {
      lines[i] = line.replace(
        /if \(\!\(await isAuditEnabledForSite\(type, site, context\)\)\) \{/,
        '// LOCAL TESTING: Bypass audit enablement check\n      if (false) { // Disabled: isAuditEnabledForSite check',
      );
      inEnabledCheck = true;
      braceDepth = 1;
      patched = true;
      continue;
    }
    if (inEnabledCheck) {
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }
      if (braceDepth === 0) {
        inEnabledCheck = false;
        lines[i] += "\n      log.info('[LOCAL TEST MODE] Bypassing audit enablement check');";
      }
    }
  }

  if (patched) {
    content = lines.join('\n');
  }

  // Bypass getScrapeResultPaths call
  const getScrapePathsPattern = /(\/\/ If there are scrape results, load the paths\s+if \(hasScrapeJobId\) \{\s+)(stepContext\.scrapeJobId = auditContext\.scrapeJobId;\s+const scrapeClient = ScrapeClient\.createFrom\(context\);\s+stepContext\.scrapeResultPaths = await scrapeClient\s+\.getScrapeResultPaths\(auditContext\.scrapeJobId\);)/s;

  if (getScrapePathsPattern.test(content)) {
    content = content.replace(
      getScrapePathsPattern,
      `$1// LOCAL TESTING: Check if we're using a mock scrape job ID (all zeros UUID)
        const isMockScrapeJobId = auditContext.scrapeJobId === '00000000-0000-0000-0000-000000000000';

        if (isMockScrapeJobId && context.scrapeResultPaths) {
          log.info('[LOCAL TEST MODE] Using pre-loaded scrape result paths from context');
          stepContext.scrapeJobId = auditContext.scrapeJobId;
          stepContext.scrapeResultPaths = context.scrapeResultPaths;
        } else {
          $2
        }`,
    );
  }

  // For multi-step: bypass loadExistingAudit and mock the audit object with local data
  if (isMultiStep) {
    const loadAuditPattern = /(\/\/ For subsequent steps, load existing audit\s+if \(hasNext\) \{\s+)(stepContext\.audit = await loadExistingAudit\(auditContext\.auditId, context\);)/s;
    if (loadAuditPattern.test(content)) {
      content = content.replace(
        loadAuditPattern,
        `$1// LOCAL TESTING: Check if we're using a mock audit ID (all zeros UUID)
        const isMockAuditId = auditContext.auditId === '00000000-0000-0000-0000-000000000000';
        if (isMockAuditId) {
          log.info('[LOCAL TEST MODE] Using mock audit object with local broken-backlinks data');
          const _bbPath = (() => { try { return require('path').join(process.cwd(), 'broken-backlinks-local.json'); } catch(e) { return '/var/task/broken-backlinks-local.json'; } })();
          const _bbExists = (() => { try { return require('fs').existsSync(_bbPath); } catch(e) { return false; } })();
          const _bbData = _bbExists ? (() => { try { return JSON.parse(require('fs').readFileSync(_bbPath, 'utf8')); } catch(e) { return {}; } })() : {};
          stepContext.audit = {
            getId: () => auditContext.auditId,
            getAuditType: () => type,
            getFullAuditRef: () => \`\${type}:\${auditContext.auditId}\`,
            getAuditedAt: () => new Date().toISOString(),
            getSiteId: () => siteId,
            getAuditResult: () => ({ success: true, brokenBacklinks: _bbData.backlinks || [] }),
            setLastAuditedAt: () => {},
            save: async () => {},
          };
          log.info('[LOCAL TEST MODE] Mock audit has ' + (_bbData.backlinks || []).length + ' broken backlinks');
        } else {
          $2
        }`,
      );
    }

    // Mock the site provider — inject baseUrl as a literal so no file reading is needed inside the container
    const mockBaseUrl = baseUrl || 'https://example.com';
    const siteProviderPattern = /(const site = await this\.siteProvider\(siteId, context\);\s+\/\/ Preserve requiresValidation.*?site\.requiresValidation = context\.site\.requiresValidation;\s+\})/s;
    if (siteProviderPattern.test(content)) {
      content = content.replace(
        siteProviderPattern,
        `// LOCAL TEST MODE: mock site object — baseUrl injected at patch time, no DynamoDB needed
      let site;
      site = {
        getId: () => siteId,
        getBaseURL: () => '${mockBaseUrl}',
        getDeliveryType: () => 'aem_edge',
        resolveFinalURL: async () => '${mockBaseUrl}',
        requiresValidation: false,
      };
      log.info('[LOCAL TEST MODE] Using mock site: ${mockBaseUrl}');`,
      );
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Patches audit-utils.js to always return true for isAuditEnabledForSite.
 */
function patchAuditUtils(auditWorkerDir) {
  const filePath = path.join(auditWorkerDir, 'src/common/audit-utils.js');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(
    /export async function isAuditEnabledForSite\([^)]*\)\s*\{/,
    `export async function isAuditEnabledForSite() {\n  // LOCAL TEST MODE: always enabled\n  return true;`,
  );
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Patches getPresignedUrl.js to return mock S3 URLs.
 */
function patchPresignedUrl(auditWorkerDir) {
  const filePath = path.join(auditWorkerDir, 'src/utils/getPresignedUrl.js');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('LOCAL TEST MODE')) return; // already patched

  // Replace only the function signature (not the body) so we avoid
  // brace-counting issues with nested braces. The original body becomes
  // dead code after the early return — syntactically valid.
  content = content.replace(
    /export (async )?function getPresignedUrl\([^)]*\)\s*\{/,
    `export async function getPresignedUrl() {\n  // LOCAL TEST MODE: return mock URL\n  return 'https://mock-s3.local/mock-audit-result.json';`,
  );
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Patches src/backlinks/handler.js to check for a local mock data file before
 * calling the Semrush API. If broken-backlinks-local.json exists in the audit
 * worker directory, the Semrush call is skipped entirely and the local data is
 * returned as the audit result.
 *
 * This is an ESM file so we inject ESM-compatible fs/path imports and a guard
 * block at the top of brokenBacklinksAuditRunner.
 */
function patchBacklinksHandler(auditWorkerDir) {
  const filePath = path.join(auditWorkerDir, 'src/backlinks/handler.js');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');

  // Inject fs + path imports before the first export/function declaration
  // Use underscore-prefixed aliases to avoid any collision with existing names.
  if (!content.includes('_localReadFileSync')) {
    content = content.replace(
      /^(export |async function |\/\*\*)/m,
      `import { readFileSync as _localReadFileSync, existsSync as _localExistsSync } from 'fs';\nimport { join as _localJoin } from 'path';\n\n$1`,
    );
  }

  // Insert local-data guard at the start of brokenBacklinksAuditRunner
  const fnSignature = /export async function brokenBacklinksAuditRunner\(auditUrl, context, site\) \{\s*\n(\s*)const \{ log \} = context;/;
  if (fnSignature.test(content) && !content.includes('[LOCAL TEST MODE] broken-backlinks')) {
    content = content.replace(fnSignature, (match, indent) => `export async function brokenBacklinksAuditRunner(auditUrl, context, site) {
${indent}const { log } = context;
${indent}// LOCAL TEST MODE: use local mock data instead of calling Semrush
${indent}const _localMockPath = _localJoin(process.cwd(), 'broken-backlinks-local.json');
${indent}if (_localExistsSync(_localMockPath)) {
${indent}  const _localMockData = JSON.parse(_localReadFileSync(_localMockPath, 'utf8'));
${indent}  log.info(\`[LOCAL TEST MODE] broken-backlinks: skipping Semrush, using \${_localMockData.backlinks?.length ?? 0} mock backlinks from broken-backlinks-local.json\`);
${indent}  return {
${indent}    fullAuditRef: auditUrl,
${indent}    auditResult: {
${indent}      finalUrl: auditUrl,
${indent}      brokenBacklinks: _localMockData.backlinks || [],
${indent}    },
${indent}  };
${indent}}`);
  }

  // Insert local-mode early return at the start of generateSuggestionData.
  // This bypasses all DynamoDB calls (Configuration, opportunity, suggestions, SQS)
  // and just logs what would be sent to Mystique — using the local mock files.
  const genSugPattern = /export const generateSuggestionData = async \(context\) => \{\s*\n(\s*)const \{\s*\n(\s*)site, audit, dataAccess, log, sqs, env, finalUrl,\s*\n(\s*)\} = context;\s*\n(\s*)const \{ Configuration, Suggestion \} = dataAccess;\s*\n\s*\n(\s*)const auditResult = audit\.getAuditResult\(\);\s*\n(\s*)if \(auditResult\.success === false\) \{/s;
  if (genSugPattern.test(content) && !content.includes('[LOCAL TEST MODE] generateSuggestionData')) {
    content = content.replace(genSugPattern, (match, i1, i2, i3, i4, i5, i6) => `export const generateSuggestionData = async (context) => {
${i1}const {
${i2}site, audit, dataAccess, log, sqs, env, finalUrl,
${i3}} = context;
${i4}const { Configuration, Suggestion } = dataAccess;

${i5}// LOCAL TEST MODE: bypass all DynamoDB/SQS calls if broken-backlinks-local.json exists
${i5}const _genLocalPath = _localJoin(process.cwd(), 'broken-backlinks-local.json');
${i5}if (_localExistsSync(_genLocalPath)) {
${i5}  log.info('[LOCAL TEST MODE] generateSuggestionData: using local mock data, skipping DynamoDB');
${i5}  const _genLocalData = JSON.parse(_localReadFileSync(_genLocalPath, 'utf8'));
${i5}  const _genBrokenLinks = (_genLocalData.backlinks || []).map((bl, _idx) => ({
${i5}    urlFrom: bl.url_from || bl.urlFrom || '',
${i5}    urlTo: bl.url_to || bl.urlTo || '',
${i5}    suggestionId: 'local-suggestion-' + _idx,
${i5}  }));
${i5}  const _genUrlsPath = _localJoin(process.cwd(), 'urls-to-scrape.txt');
${i5}  const _genAltUrls = _localExistsSync(_genUrlsPath)
${i5}    ? _localReadFileSync(_genUrlsPath, 'utf8').split('\\n').map(u => u.trim()).filter(Boolean)
${i5}    : [];
${i5}  const _genMessage = {
${i5}    type: 'guidance:broken-links',
${i5}    siteId: site.getId(),
${i5}    auditId: audit.getId(),
${i5}    deliveryType: site.getDeliveryType(),
${i5}    time: new Date().toISOString(),
${i5}    data: {
${i5}      opportunityId: 'local-test-opportunity-id',
${i5}      alternativeUrls: _genAltUrls,
${i5}      brokenLinks: _genBrokenLinks,
${i5}    },
${i5}  };
${i5}  log.info('[LOCAL TEST MODE] Sending broken-links message to local Mystique via Localstack SQS...');
${i5}  log.info('[LOCAL TEST MODE] Summary: ' + _genBrokenLinks.length + ' broken links, ' + _genAltUrls.length + ' alternative URLs');
${i5}  try {
${i5}    const { SQSClient: _SQSClient, SendMessageCommand: _SendMessageCommand } = await import('@aws-sdk/client-sqs');
${i5}    const _localstackHost = process.env.LOCALSTACK_HOST || 'host.docker.internal';
${i5}    const _localstackEndpoint = 'http://' + _localstackHost + ':4566';
${i5}    const _sqsLocal = new _SQSClient({
${i5}      region: 'us-east-1',
${i5}      endpoint: _localstackEndpoint,
${i5}      credentials: { accessKeyId: 'localstack', secretAccessKey: 'localstack' },
${i5}    });
${i5}    const _sqsResult = await _sqsLocal.send(new _SendMessageCommand({
${i5}      QueueUrl: _localstackEndpoint + '/000000000000/spacecat-to-mystique',
${i5}      MessageBody: JSON.stringify(_genMessage),
${i5}    }));
${i5}    log.info('[LOCAL TEST MODE] Message sent to Localstack SQS (MessageId: ' + _sqsResult.MessageId + ')');
${i5}  } catch (_sqsErr) {
${i5}    log.error('[LOCAL TEST MODE] Failed to send to Localstack SQS: ' + _sqsErr.message);
${i5}    log.error('[LOCAL TEST MODE] Is Localstack running? Start with: cd mystique && docker-compose up localstack');
${i5}  }
${i5}  return { status: 'complete' };
${i5}}

${i5}const auditResult = audit.getAuditResult();
${i6}if (auditResult.success === false) {`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Writes the broken-backlinks mock data file into the audit worker directory.
 * The file is read by the patched handler.js instead of calling Semrush.
 */
function writeBrokenBacklinksMock(auditWorkerDir, backlinks) {
  const mockPath = path.join(auditWorkerDir, 'broken-backlinks-local.json');
  const payload = {
    importedAt: new Date().toISOString(),
    backlinks,
  };
  fs.writeFileSync(mockPath, JSON.stringify(payload, null, 2));
}

/**
 * Removes the broken-backlinks mock data file from the audit worker directory.
 */
function removeBrokenBacklinksMock(auditWorkerDir) {
  const mockPath = path.join(auditWorkerDir, 'broken-backlinks-local.json');
  if (fs.existsSync(mockPath)) fs.unlinkSync(mockPath);
}

/**
 * Returns true if a broken-backlinks mock data file exists in the audit worker directory.
 */
function hasBrokenBacklinksMock(auditWorkerDir) {
  if (!auditWorkerDir) return false;
  const mockPath = path.join(auditWorkerDir, 'broken-backlinks-local.json');
  return fs.existsSync(mockPath);
}

/**
 * Applies all patches to the audit worker files.
 * Does NOT copy master files — patches whatever is currently in the repo.
 *
 * @param {string} auditWorkerDir
 * @param {object} params - { auditType, siteId, baseUrl, useLocalScraperData, useLocalTopPages, topPagesFile, isMultiStep }
 */
function applyPatches(auditWorkerDir, params) {
  // Backup all patch targets first
  for (const relPath of PATCH_TARGETS) {
    const fullPath = path.join(auditWorkerDir, relPath);
    backupFile(fullPath);
  }

  // Write fresh config file
  writeLocalConfig(auditWorkerDir, params);

  // Apply targeted patches to each file
  patchIndexLocal(auditWorkerDir, params);
  patchStepAudit(auditWorkerDir, params);
  patchAuditUtils(auditWorkerDir);
  patchPresignedUrl(auditWorkerDir);
  patchBacklinksHandler(auditWorkerDir);
  // metatags-auto-suggest.js and headings/handler.js: the backup is enough;
  // the SAM env.json disables those code paths via env vars (GENVAR_ENABLED=false etc.)

  // Sync patched source files into the SAM build directory.
  // SAM local invoke mounts .aws-sam/build/... not src/ — so patches applied to
  // src/ are invisible to the Lambda unless we copy them here.
  const buildDir = path.join(auditWorkerDir, '.aws-sam', 'build', 'SpacecatAuditWorkerFunction');
  if (fs.existsSync(buildDir)) {
    for (const relPath of PATCH_TARGETS) {
      const srcPath = path.join(auditWorkerDir, relPath);
      const dstPath = path.join(buildDir, relPath);
      if (fs.existsSync(srcPath) && fs.existsSync(path.dirname(dstPath))) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
    // Also copy local-config.json and broken-backlinks-local.json into build dir
    const extras = ['local-config.json', 'broken-backlinks-local.json', 'urls-to-scrape.txt'];
    for (const f of extras) {
      const src = path.join(auditWorkerDir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(buildDir, f));
    }
  }
}

/**
 * Restores all patched files from their backups and removes temp files.
 * Does NOT remove broken-backlinks-local.json — that's user data and persists
 * across runs so the mock can be reused. Call removeBrokenBacklinksMock() explicitly.
 */
function restoreAll(auditWorkerDir) {
  for (const relPath of PATCH_TARGETS) {
    const fullPath = path.join(auditWorkerDir, relPath);
    restoreFile(fullPath);
  }
  removeLocalConfig(auditWorkerDir);

  // Remove SAM temp files
  for (const tmp of ['src/indexlocal.js', 'template-local.yml', 'env.json']) {
    const p = path.join(auditWorkerDir, tmp);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

module.exports = {
  PATCH_TARGETS,
  checkLocalChanges,
  applyPatches,
  restoreAll,
  writeLocalConfig,
  removeLocalConfig,
  writeBrokenBacklinksMock,
  removeBrokenBacklinksMock,
  hasBrokenBacklinksMock,
};
