/* ─── SpaceCat Local Dev — Frontend ─────────────────────────────────────────
 *
 * All state lives here. No build step, no framework — plain ES2020.
 *
 * Key objects:
 *   state       — mutable app state (selectedAudit, currentJobId, …)
 *   FLOWS       — loaded from /api/audit-flows at startup
 *   config      — loaded from /api/config (spacecat-config.sh values)
 *   services    — loaded from /api/services (port checks)
 * ─────────────────────────────────────────────────────────────────────────── */

const state = {
  flows: {},
  config: {},
  lastRun: {},
  selectedAudit: null,
  currentJobId: null,
  currentStepId: null,
  jobStatus: 'idle',   // 'idle' | 'running' | 'success' | 'error'
  sse: null,
  stepStates: {},      // stepId → 'idle' | 'running' | 'done' | 'error'
  lastAuditJobId: null,
  mystiquePoller: null,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const [flowsRes, configRes] = await Promise.all([
      fetch('/api/audit-flows'),
      fetch('/api/config'),
    ]);
    state.flows = await flowsRes.json();
    const configData = await configRes.json();
    state.config = configData.config;
    state.lastRun = configData.lastRun || {};
  } catch (e) {
    console.error('Boot failed:', e);
  }

  renderConfigStatus();
  renderAuditList();
  loadLastRun();
  refreshServices(true);
  refreshCredentialsStatus();

  // Restore last selected audit
  const lastAuditType = state.lastRun?.audit?.lastAuditType;
  if (lastAuditType && state.flows[lastAuditType]) {
    selectAudit(lastAuditType);
  }

  // Reconnect to any job that was running before a page refresh
  await reconnectActiveJob();
}

async function reconnectActiveJob() {
  const savedJobId = sessionStorage.getItem('activeJobId');
  const savedStepId = sessionStorage.getItem('activeStepId') || 'audit';
  if (!savedJobId) return;

  try {
    const res = await fetch(`/api/jobs/${savedJobId}`);
    if (!res.ok) {
      // Job gone from server (server restarted) — clear saved state
      sessionStorage.removeItem('activeJobId');
      sessionStorage.removeItem('activeStepId');
      return;
    }
    const job = await res.json();
    if (job.status !== 'running') {
      sessionStorage.removeItem('activeJobId');
      sessionStorage.removeItem('activeStepId');
      return;
    }
    // Job is still running — reconnect
    state.currentJobId = savedJobId;
    state.currentStepId = savedStepId;
    setJobStatus('running', savedStepId);
    setStepState(savedStepId, 'running');
    appendLog('info', `─── Reconnected to running job ${savedJobId} ───`);
    streamJob(savedJobId, savedStepId);
  } catch {
    sessionStorage.removeItem('activeJobId');
    sessionStorage.removeItem('activeStepId');
  }
}

// ─── Config status (topbar) ───────────────────────────────────────────────────

function renderConfigStatus() {
  const el = document.getElementById('config-status');
  const txt = document.getElementById('config-status-text');
  if (state.config.configured) {
    el.className = 'config-pill ok';
    const dir = (state.config.auditWorkerDir || '').split('/').slice(-2).join('/');
    txt.textContent = dir || 'configured';
  } else {
    el.className = 'config-pill warn';
    txt.textContent = 'not configured';
  }
}

// ─── Last-run values → input fields ──────────────────────────────────────────

function loadLastRun() {
  const lr = state.lastRun;
  if (lr?.audit?.lastSiteId) setVal('inp-site-id', lr.audit.lastSiteId);
  if (lr?.audit?.lastBaseUrl) setVal('inp-base-url', lr.audit.lastBaseUrl);
  if (lr?.scraper?.lastSiteId && !getVal('inp-site-id')) setVal('inp-site-id', lr.scraper.lastSiteId);
}

// ─── AWS Credentials ─────────────────────────────────────────────────────────

function toggleCredsPanel() {
  const panel = document.getElementById('creds-panel');
  const chevron = document.getElementById('creds-chevron');
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(180deg)' : '';
}

async function refreshCredentialsStatus() {
  try {
    const res = await fetch('/api/credentials/status');
    const { keys } = await res.json();
    renderCredentialsStatus(keys);
  } catch { /* ignore */ }
}

function renderCredentialsStatus(keys) {
  const badge = document.getElementById('creds-status-badge');
  const keysEl = document.getElementById('creds-keys');
  const hasId = keys.includes('AWS_ACCESS_KEY_ID');
  const hasSecret = keys.includes('AWS_SECRET_ACCESS_KEY');
  const hasToken = keys.includes('AWS_SESSION_TOKEN');
  const allSet = hasId && hasSecret && hasToken;

  badge.textContent = allSet ? 'set' : keys.length > 0 ? 'partial' : 'not set';
  badge.className = `creds-badge ${allSet ? 'set' : keys.length > 0 ? 'partial' : 'unset'}`;

  if (keysEl) {
    keysEl.innerHTML = keys.length > 0
      ? keys.map((k) => `<span class="creds-key">${k}</span>`).join('')
      : '';
  }
}

async function saveCredentials() {
  const raw = document.getElementById('inp-creds').value;
  if (!raw.trim()) return;
  try {
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const ct = res.headers.get('content-type') || '';
      const msg = ct.includes('json') ? (await res.json()).error : `HTTP ${res.status} — try restarting the webapp server`;
      logInfo(`Credentials error: ${msg}`);
      return;
    }
    const data = await res.json();
    renderCredentialsStatus(data.keys);
    document.getElementById('inp-creds').value = '';
  } catch (e) {
    logInfo(`Credentials error: ${e.message}`);
  }
}

async function clearCredentials() {
  await fetch('/api/credentials', { method: 'DELETE' });
  renderCredentialsStatus([]);
}

// ─── Audit list (sidebar) ─────────────────────────────────────────────────────

function renderAuditList() {
  const list = document.getElementById('audit-list');
  list.innerHTML = '';
  for (const [type, flow] of Object.entries(state.flows)) {
    const item = document.createElement('div');
    item.className = 'audit-item';
    item.dataset.type = type;
    item.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      ${flow.label}
      ${flow.requiresScraper ? '<span class="badge needs-scraper">scraper</span>' : ''}
    `;
    item.addEventListener('click', () => selectAudit(type));
    list.appendChild(item);
  }
}

// ─── Audit selection ──────────────────────────────────────────────────────────

async function selectAudit(type) {
  state.selectedAudit = type;
  state.stepStates = {};

  // Sidebar active state
  document.querySelectorAll('.audit-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.type === type);
  });

  // Show/hide sidebar fields based on audit type
  const rumField = document.getElementById('field-rum-key');
  if (rumField) rumField.style.display = type === 'broken-internal-links' ? '' : 'none';

  // Show panel
  document.getElementById('main-placeholder').style.display = 'none';
  document.getElementById('audit-panel').style.display = 'flex';

  const flow = state.flows[type];
  document.getElementById('audit-title').textContent = flow.label;
  document.getElementById('audit-desc').textContent = flow.description;

  // Reset step states
  flow.steps.forEach((s) => { state.stepStates[s.id] = 'idle'; });

  // Check mock import status for broken-backlinks
  if (type === 'broken-backlinks') {
    await refreshMockStatus();
  }

  renderPipeline(type);
  await refreshDataStatus();
  await refreshLocalChangesWarning();
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

function renderPipeline(type) {
  const flow = state.flows[type];
  const container = document.getElementById('pipeline');
  container.innerHTML = '';

  flow.steps.forEach((step, idx) => {
    const stepState = state.stepStates[step.id] || 'idle';
    const div = document.createElement('div');
    div.id = `step-${step.id}`;

    // Mock import step gets special treatment
    if (step.isMockImport) {
      div.className = `pipeline-step ${state.mockStatus?.active ? 'done' : 'idle'}`;
      div.innerHTML = renderMockImportStep(step, idx);
      container.appendChild(div);
      return;
    }

    div.className = `pipeline-step ${stepState}`;

    const iconContent = stepState === 'done' ? '✓'
      : stepState === 'running' ? '…'
      : String(idx + 1);

    const requiredPills = (step.dataRequired || []).map((d) =>
      `<span class="step-data-pill required">needs: ${d}</span>`).join('');
    const producedPills = (step.dataProduced || []).map((d) =>
      `<span class="step-data-pill produced">→ ${d}</span>`).join('');
    const dataPills = requiredPills || producedPills
      ? `<div class="step-data">${requiredPills}${producedPills}</div>` : '';

    const currentEnv = (document.getElementById('inp-api-env') || {}).value || 'stage';
    const envLabel   = currentEnv === 'prod' ? 'Prod' : 'Stage';

    const extraInput = step.id === 'fetch-rum'
      ? `<div class="step-extra">
           <label>RUM domain key</label>
           <input id="step-rum-key" type="text" value="${escHtml(getVal('inp-rum-key'))}" placeholder="rum-domain-key" oninput="document.getElementById('inp-rum-key').value=this.value">
         </div>`
      : '';

    const cmd = buildCmd(type, step);

    // Top-pages gets a clean two-button layout with no command line shown
    if (step.id === 'top-pages') {
      const isRunning = stepState === 'running';
      div.innerHTML = `
        <div class="step-icon">${iconContent}</div>
        <div class="step-body">
          <div class="step-header">
            <span class="step-label">${step.label}</span>
            ${step.optional ? '<span class="step-optional">optional</span>' : ''}
          </div>
          <div class="step-desc">${step.description}
            <span style="color:var(--text-dim);font-size:11px">(${envLabel} key from config)</span>
          </div>
          ${dataPills}
          <div class="step-cmd-row">
            <button class="run-btn" id="run-btn-${step.id}"
              onclick="runStep('${type}', '${step.id}')"
              ${isRunning ? 'disabled' : ''}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              ${isRunning ? 'Fetching…' : 'Fetch from API'}
            </button>
            <button class="copy-btn" onclick="openUrlListModal()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              Paste URL list
            </button>
            <button class="copy-btn" onclick="copyCmd('${escAttr(cmd)}', this)" title="${escHtml(cmd)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy command
            </button>
          </div>
        </div>
      `;
      container.appendChild(div);
      return;
    }

    const runLabel = stepState === 'running' ? 'Running…' : 'Run';

    div.innerHTML = `
      <div class="step-icon">${iconContent}</div>
      <div class="step-body">
        <div class="step-header">
          <span class="step-label">${step.label}</span>
          ${step.optional ? '<span class="step-optional">optional</span>' : ''}
        </div>
        <div class="step-desc">${step.description}</div>
        ${dataPills}
        ${extraInput}
        <div class="step-cmd-row">
          <button class="copy-btn" onclick="copyCmd('${escAttr(cmd)}', this)" title="${escHtml(cmd)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy command
          </button>
          <button class="run-btn" id="run-btn-${step.id}"
            onclick="runStep('${type}', '${step.id}')"
            ${stepState === 'running' ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            ${runLabel}
          </button>
        </div>
      </div>
    `;

    container.appendChild(div);
  });
}

// ─── Mock import step renderer ────────────────────────────────────────────────

function renderMockImportStep(step, idx) {
  const active = state.mockStatus?.active;
  const count  = state.mockStatus?.count ?? 0;
  const iconContent = active ? '✓' : String(idx + 1);

  const currentEnv = (document.getElementById('inp-api-env') || {}).value || 'stage';
  const envLabel = currentEnv === 'prod' ? 'Prod' : 'Stage';

  const statusBadge = active
    ? `<span class="mock-status-badge active">${count} rows loaded — Semrush will be skipped</span>`
    : `<span class="mock-status-badge">No data loaded — will call Semrush</span>`;

  const clearBtn = active
    ? `<button class="copy-btn" style="color:var(--red);border-color:var(--red)" onclick="clearMockData()">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
           <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
         </svg>
         Clear
       </button>` : '';

  return `
    <div class="step-icon">${iconContent}</div>
    <div class="step-body">
      <div class="step-header">
        <span class="step-label">${step.label}</span>
        <span class="step-optional">optional</span>
      </div>
      <div class="step-desc">${step.description}</div>
      ${statusBadge}
      <div class="mock-import-box" id="mock-import-box" style="${active ? 'display:none' : ''}">
        <div class="mock-source-section">
          <div class="mock-source-label">Option A — Fetch from SpaceCat API <span style="color:var(--text-dim);font-weight:400">(${envLabel} key from config)</span></div>
          <div class="mock-api-row">
            <button class="copy-btn" id="mock-fetch-btn" onclick="fetchBacklinksFromApi()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Fetch
            </button>
            <span id="mock-fetch-status" style="font-size:11px;color:var(--text-dim)"></span>
          </div>
        </div>
        <div class="mock-source-label">Option B — Paste custom rows</div>
        <textarea id="mock-paste-area" placeholder="Paste rows here. Accepted formats:

• CSV/TSV from the full-report tool (headers auto-detected)
  Referring domain and page, Broken target URL, Priority, Suggestion

• Two bare URLs per line (tab or comma separated):
  https://referring.com/page   https://customer.com/broken

• JSON array:
  [{ &quot;url_from&quot;: &quot;...&quot;, &quot;url_to&quot;: &quot;...&quot;, &quot;traffic_domain&quot;: 80 }]

Or click &quot;Fetch&quot; above to auto-populate from the API, then edit or delete rows before importing."></textarea>
        <div class="mock-import-actions">
          <button class="run-btn" onclick="importMockData()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Import
          </button>
          <span id="mock-import-error" style="color:var(--red);font-size:11px"></span>
        </div>
      </div>
      ${active ? `<div style="margin-top:6px;display:flex;gap:6px;align-items:center">${clearBtn}<button class="copy-btn" onclick="showMockEditArea()">Edit</button></div>` : ''}
    </div>
  `;
}

// ─── Mock data management ─────────────────────────────────────────────────────

state.mockStatus = { active: false, count: 0 };

async function refreshMockStatus() {
  try {
    const res = await fetch('/api/import/broken-backlinks/status');
    state.mockStatus = await res.json();
  } catch {
    state.mockStatus = { active: false, count: 0 };
  }
}

async function importMockData() {
  const raw = (document.getElementById('mock-paste-area') || {}).value || '';
  if (!raw.trim()) {
    document.getElementById('mock-import-error').textContent = 'Nothing pasted yet.';
    return;
  }
  document.getElementById('mock-import-error').textContent = '';
  try {
    const res = await fetch('/api/import/broken-backlinks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('mock-import-error').textContent = data.error || 'Import failed';
      return;
    }
    state.mockStatus = { active: true, count: data.count };
    renderPipeline(state.selectedAudit);
    showTooltip(`${data.count} rows imported — Semrush will be skipped`);
  } catch (e) {
    document.getElementById('mock-import-error').textContent = `Network error: ${e.message}`;
  }
}

async function clearMockData() {
  await fetch('/api/import/broken-backlinks', { method: 'DELETE' });
  state.mockStatus = { active: false, count: 0 };
  renderPipeline(state.selectedAudit);
}

async function showMockEditArea() {
  const box = document.getElementById('mock-import-box');
  if (box) box.style.display = '';
  // Populate textarea with currently loaded data so the user can edit/delete rows
  try {
    const res = await fetch('/api/import/broken-backlinks');
    const data = await res.json();
    if (data.backlinks && data.backlinks.length > 0) {
      const ta = document.getElementById('mock-paste-area');
      if (ta && !ta.value.trim()) {
        ta.value = JSON.stringify(data.backlinks, null, 2);
      }
    }
  } catch { /* ignore — textarea stays empty */ }
}

function openUrlListModal() {
  document.getElementById('url-list-modal').style.display = 'flex';
  const statusEl = document.getElementById('url-list-modal-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
  setTimeout(() => {
    const ta = document.getElementById('url-list-modal-area');
    if (ta) ta.focus();
  }, 50);
}

function closeUrlListModal(e) {
  if (e && e.target !== document.getElementById('url-list-modal')) return;
  document.getElementById('url-list-modal').style.display = 'none';
}

async function saveTopPagesList() {
  const ta = document.getElementById('url-list-modal-area');
  const statusEl = document.getElementById('url-list-modal-status');
  const raw = (ta || {}).value || '';
  const urls = raw.split('\n').map((u) => u.trim()).filter(Boolean);
  if (!urls.length) {
    if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Paste some URLs first.'; }
    return;
  }
  if (statusEl) { statusEl.style.color = 'var(--text-dim)'; statusEl.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/save-top-pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = data.error || 'Failed'; }
      return;
    }
    document.getElementById('url-list-modal').style.display = 'none';
    setStepState('top-pages', 'done');
    await refreshDataStatus();
    showTooltip(`${data.count} URLs saved`);
  } catch (e) {
    if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = `Error: ${e.message}`; }
  }
}

async function fetchBacklinksFromApi() {
  const siteId = getVal('inp-site-id').trim();
  if (!siteId) {
    const statusEl = document.getElementById('mock-fetch-status');
    if (statusEl) statusEl.textContent = 'Enter a Site ID first.';
    return;
  }

  const environment = getVal('inp-api-env') || 'stage';
  const statusEl = document.getElementById('mock-fetch-status');
  const btn = document.getElementById('mock-fetch-btn');

  if (statusEl) statusEl.textContent = 'Fetching…';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/fetch-backlinks-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, environment }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (statusEl) statusEl.style.color = 'var(--red)';
      if (statusEl) statusEl.textContent = `Error: ${data.error}`;
      return;
    }

    // Populate textarea with pretty-printed JSON the user can edit
    const ta = document.getElementById('mock-paste-area');
    if (ta) {
      ta.value = JSON.stringify(data.backlinks, null, 2);
    }

    if (statusEl) {
      statusEl.style.color = 'var(--green, #4caf50)';
      statusEl.textContent = `${data.count} rows fetched — edit if needed, then click Import`;
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = `Network error: ${err.message}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Build resolved command string ───────────────────────────────────────────

function buildCmd(type, step) {
  const siteId = getVal('inp-site-id') || '<siteId>';
  const baseUrl = getVal('inp-base-url') || '<baseUrl>';
  const rumKey = getVal('inp-rum-key') || '<rumDomainKey>';
  const dir = state.config.toolsDir || '$SPACECAT_TOOLS_DIR';

  if (step.id === 'scrape') {
    return `cd ${dir} && SITE_ID=${siteId} NON_INTERACTIVE=true bash run-scraper.sh`;
  }
  if (step.id === 'top-pages') {
    return `cd ${dir} && SITE_ID=${siteId} bash get-top-pages.sh`;
  }
  if (step.id === 'fetch-rum') {
    return `cd ${dir} && SITE_ID=${siteId} BASE_URL=${baseUrl} RUM_DOMAIN_KEY=${rumKey} NON_INTERACTIVE=true bash fetch-broken-links.sh`;
  }
  // audit step
  return `cd ${dir} && AUDIT_TYPE=${type} SITE_ID=${siteId} BASE_URL=${baseUrl} NON_INTERACTIVE=true bash run-audit-worker.sh`;
}

// ─── Data status bar ──────────────────────────────────────────────────────────

async function refreshDataStatus() {
  const siteId = getVal('inp-site-id');
  const bar = document.getElementById('data-status-bar');
  if (!siteId) {
    bar.innerHTML = '<span class="ds-pill"><span class="dot"></span>Enter a Site ID to see data status</span>';
    return;
  }
  try {
    const res = await fetch(`/api/status?siteId=${encodeURIComponent(siteId)}`);
    const data = await res.json();
    const pills = [];

    const sd = data.scraperData;
    pills.push(`<div class="ds-pill ${sd.exists ? 'ok' : ''}">
      <span class="dot"></span>
      Scraper data: ${sd.exists ? `${sd.count} files` : 'none'}
    </div>`);

    const ld = data.localData;
    pills.push(`<div class="ds-pill ${ld.urlsFile ? 'ok' : ''}">
      <span class="dot"></span>
      urls-to-scrape.txt: ${ld.urlsFile ? 'exists' : 'none'}
    </div>`);

    pills.push(`<div class="ds-pill ${ld.brokenLinksFile ? 'ok' : 'warn'}">
      <span class="dot"></span>
      broken-links JSON: ${ld.brokenLinksFile ? 'exists' : 'none'}
    </div>`);

    bar.innerHTML = pills.join('');
  } catch (e) {
    bar.innerHTML = '<span class="ds-pill">Could not fetch status</span>';
  }
}

// ─── Local changes warning ────────────────────────────────────────────────────

async function refreshLocalChangesWarning() {
  const warning = document.getElementById('local-changes-warning');
  const list = document.getElementById('local-changes-list');
  if (!state.config.auditWorkerDir) { warning.style.display = 'none'; return; }
  try {
    const res = await fetch('/api/local-changes');
    const changes = await res.json();
    const changed = changes.filter((c) => c.exists && c.changed);
    if (changed.length > 0) {
      list.innerHTML = changed.map((c) => `<li>${c.file}</li>`).join('');
      warning.style.display = 'flex';
    } else {
      warning.style.display = 'none';
    }
  } catch {
    warning.style.display = 'none';
  }
}

// ─── Services panel ───────────────────────────────────────────────────────────

state.mystiqueRestarting = false;

async function refreshServices(showSpinner = false) {
  const container = document.getElementById('service-list');
  if (showSpinner) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:11px">Checking…</div>';
  }
  try {
    const res = await fetch('/api/services');
    const services = await res.json();
    container.innerHTML = services.map((svc) => {
      const isRestarting = svc.id === 'mystique' && state.mystiqueRestarting;
      const dotClass = isRestarting ? 'restarting' : (svc.running ? 'running' : 'stopped');
      let action = '';
      if (svc.id === 'mystique') {
        action = isRestarting
          ? '<span style="font-size:10px;color:var(--yellow)">restarting…</span>'
          : `<button class="service-cmd-btn" onclick="restartMystique()" title="Kill and restart Mystique with your current local code">restart</button>`;
      } else if (!svc.running) {
        action = `<button class="service-cmd-btn" onclick="copyCmd('${escAttr(svc.startCommand)}', this)" title="${escAttr(svc.startCommand)}">start cmd</button>`;
      }
      return `
        <div class="service-row">
          <span class="service-dot ${dotClass}"></span>
          <span class="service-name">${svc.label}</span>
          <span class="service-port">:${svc.port}</span>
          ${action}
        </div>`;
    }).join('');
  } catch {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:11px">Failed to check services</div>';
  }
}

document.getElementById('services-refresh').addEventListener('click', () => refreshServices(true));

// Auto-refresh services every 8 seconds so dots always reflect actual state
setInterval(() => {
  if (!state.mystiqueRestarting) refreshServices();
}, 8000);

async function restartMystique() {
  if (state.mystiqueRestarting) return;
  state.mystiqueRestarting = true;
  await refreshServices(); // await so yellow dot renders before we proceed

  if (state.selectedAudit) switchTab('audit'); // show the terminal
  appendLog('info', '─── Restarting Mystique… ───');

  try {
    const res = await fetch('/api/services/restart-mystique', { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      appendLog('stderr', `Mystique restart error: ${d.error || 'unknown'}`);
      state.mystiqueRestarting = false;
      await refreshServices();
      return;
    }
  } catch (e) {
    appendLog('stderr', `Mystique restart network error: ${e.message}`);
    state.mystiqueRestarting = false;
    await refreshServices();
    return;
  }

  // Poll for readiness, streaming Mystique's stdout/stderr into the main terminal
  let logOffset = 0;
  const deadline = Date.now() + 600_000;
  let ready = false;

  while (Date.now() < deadline && !ready) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const logData = await (await fetch(`/api/services/mystique-log?offset=${logOffset}`)).json();
      for (const line of logData.lines) appendLog('stderr', line);
      logOffset = logData.total;
    } catch { /* ignore */ }
    try {
      const { running } = await (await fetch('/api/services/check-mystique')).json();
      ready = running;
    } catch { /* keep polling */ }
  }

  state.mystiqueRestarting = false;
  appendLog('info', ready ? '─── Mystique is ready ───' : '─── Mystique did not respond in 10 min ───');
  await refreshServices();
}

// ─── Run a step ───────────────────────────────────────────────────────────────

async function runStep(auditType, stepId) {
  if (stepId === 'import-mock') return; // handled by importMockData()
  if (state.jobStatus === 'running') return;

  // If there's an active SSE, close it
  if (state.sse) { state.sse.close(); state.sse = null; }

  const siteId = getVal('inp-site-id').trim();
  const baseUrl = getVal('inp-base-url').trim();
  const rumKey = getVal('inp-rum-key').trim();

  if (!siteId) {
    logInfo('Please enter a Site ID before running.');
    return;
  }

  clearLog();
  setJobStatus('running', stepId);
  state.currentStepId = stepId;
  setStepState(stepId, 'running');

  let endpoint = '';
  let body = {};

  if (stepId === 'scrape') {
    endpoint = '/api/run/scraper';
    body = { siteId };
  } else if (stepId === 'top-pages') {
    const environment = (document.getElementById('inp-api-env') || {}).value || 'stage';
    endpoint = '/api/run/top-pages';
    body = { siteId, environment };
  } else if (stepId === 'fetch-rum') {
    if (!rumKey) { logInfo('RUM domain key is required for this step.'); setJobStatus('idle'); setStepState(stepId, 'idle'); return; }
    endpoint = '/api/run/fetch-broken-links';
    body = { siteId, baseUrl, rumDomainKey: rumKey };
  } else {
    // audit step
    const flow = state.flows[auditType];
    const isMultiStep = flow && flow.steps.some((s) => s.id === 'fetch-rum');
    endpoint = '/api/run/audit';
    // broken-backlinks always uses local top pages (the "Get Top Pages" step produces them)
    const useLocalTopPages = auditType === 'broken-backlinks';
    body = { auditType, siteId, baseUrl, useLocalScraperData: false, useLocalTopPages };

  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      logInfo(`Error: ${err.error || res.statusText}`);
      setJobStatus('error');
      setStepState(stepId, 'error');
      return;
    }

    const { jobId } = await res.json();
    state.currentJobId = jobId;
    if (stepId === 'audit') {
      state.lastAuditJobId = jobId;
      hideResultsPanel();
    }
    sessionStorage.setItem('activeJobId', jobId);
    sessionStorage.setItem('activeStepId', stepId);
    streamJob(jobId, stepId);
  } catch (e) {
    logInfo(`Network error: ${e.message}`);
    setJobStatus('error');
    setStepState(stepId, 'error');
  }
}

// ─── SSE streaming ────────────────────────────────────────────────────────────

function streamJob(jobId, stepId) {
  const sse = new EventSource(`/api/stream/${jobId}`);
  state.sse = sse;

  const handleLine = (type, text) => appendLog(type, text);

  sse.addEventListener('stdout', (e) => { const d = JSON.parse(e.data); handleLine('stdout', d.text); });
  sse.addEventListener('stderr', (e) => { const d = JSON.parse(e.data); handleLine('stderr', d.text); });
  sse.addEventListener('error',  (e) => { if (e.data) { const d = JSON.parse(e.data); handleLine('error', d.text); } });

  sse.addEventListener('done', (e) => {
    // The runner wraps the payload as { text: '{"status":...,"code":...}', ts }
    const outer = JSON.parse(e.data);
    const d = JSON.parse(outer.text);
    const ok = d.status === 'success';
    setJobStatus(d.status);
    setStepState(stepId, ok ? 'done' : 'error');
    appendLog('done', `─── Process exited with code ${d.code ?? '?'} (${d.status}) ───`);
    sse.close();
    state.sse = null;
    sessionStorage.removeItem('activeJobId');
    sessionStorage.removeItem('activeStepId');
    // Refresh data status after a run
    refreshDataStatus();
    refreshLocalChangesWarning();
    // If on broken-backlinks, refresh mock status badge (fetch-from-api may have written the file)
    if (state.selectedAudit === 'broken-backlinks') {
      refreshMockStatus().then(() => renderPipeline('broken-backlinks'));
    }
    // Show results panel for broken-backlinks audit
    if (ok && state.selectedAudit === 'broken-backlinks' && stepId === 'audit') {
      loadResults(jobId);
    }
  });

  sse.onerror = () => {
    // SSE closed — job likely finished; poll once
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((job) => {
        if (job.status && job.status !== 'running') {
          setJobStatus(job.status);
          setStepState(stepId, job.status === 'success' ? 'done' : 'error');
        }
      })
      .catch(() => {});
    sse.close();
    state.sse = null;
  };
}

// ─── Job status & step state ──────────────────────────────────────────────────

function setJobStatus(status, stepId) {
  state.jobStatus = status;
  const badge = document.getElementById('log-status-badge');
  const killBtn = document.getElementById('btn-kill');

  badge.className = `log-status-badge ${status || 'idle'}`;
  badge.textContent = !status || status === 'idle' ? '' : status.toUpperCase();

  killBtn.style.display = status === 'running' ? 'inline-flex' : 'none';

  // Update run button
  const activeStep = stepId || state.currentStepId;
  if (activeStep) {
    const btn = document.getElementById(`run-btn-${activeStep}`);
    if (btn) {
      btn.disabled = status === 'running';
      btn.classList.toggle('running', status === 'running');
      btn.querySelector('svg + *') // text node hack — update innerHTML
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        ${status === 'running' ? 'Running…' : 'Run'}
      `;
    }
  }
}

function setStepState(stepId, newState) {
  state.stepStates[stepId] = newState;
  const stepEl = document.getElementById(`step-${stepId}`);
  if (stepEl) {
    stepEl.className = `pipeline-step ${newState}`;
    const icon = stepEl.querySelector('.step-icon');
    if (icon) {
      if (newState === 'done') icon.textContent = '✓';
      else if (newState === 'running') icon.textContent = '…';
      else if (newState === 'error') icon.textContent = '✗';
    }
  }
}

// ─── Kill job ────────────────────────────────────────────────────────────────

document.getElementById('btn-kill').addEventListener('click', async () => {
  if (!state.currentJobId) return;
  await fetch(`/api/jobs/${state.currentJobId}`, { method: 'DELETE' });
  if (state.sse) { state.sse.close(); state.sse = null; }
  setJobStatus('error');
  if (state.currentStepId) setStepState(state.currentStepId, 'error');
  appendLog('done', '─── Killed by user ───');
  sessionStorage.removeItem('activeJobId');
  sessionStorage.removeItem('activeStepId');
});

// ─── Log output ───────────────────────────────────────────────────────────────

function appendLog(type, text) {
  const out = document.getElementById('log-output');
  // Remove placeholder
  const placeholder = out.querySelector('.log-empty');
  if (placeholder) placeholder.remove();

  const line = document.createElement('div');
  line.className = `line ${type}`;

  const now = new Date();
  const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  line.innerHTML = `<span class="ts">${ts}</span><span class="txt">${escHtml(text)}</span>`;
  out.appendChild(line);

  // Auto-scroll if near bottom
  if (out.scrollHeight - out.scrollTop - out.clientHeight < 80) {
    out.scrollTop = out.scrollHeight;
  }
}

function logInfo(msg) {
  appendLog('info', msg);
}

function clearLog() {
  const out = document.getElementById('log-output');
  out.innerHTML = '<div class="log-empty">Running…</div>';
}

document.getElementById('btn-clear').addEventListener('click', () => {
  document.getElementById('log-output').innerHTML = '<div class="log-empty">No output yet — run a step above to see logs here.</div>';
  setJobStatus('idle');
  state.currentJobId = null;
});

// ─── Copy to clipboard ────────────────────────────────────────────────────────

function copyCmd(cmd, btn) {
  navigator.clipboard.writeText(cmd).then(() => {
    if (btn) {
      const prev = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = prev; }, 1500);
    }
    showTooltip('Copied to clipboard');
  });
}

function showTooltip(msg) {
  const tip = document.getElementById('cmd-tooltip');
  tip.textContent = msg;
  tip.classList.add('show');
  setTimeout(() => tip.classList.remove('show'), 2000);
}

// ─── Auto-refresh pipeline when inputs change ─────────────────────────────────

['inp-site-id', 'inp-base-url', 'inp-rum-key'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => {
    if (state.selectedAudit) {
      renderPipeline(state.selectedAudit);
      clearTimeout(window._statusTimer);
      window._statusTimer = setTimeout(refreshDataStatus, 400);
    }
  });
});

// Re-render pipeline when env changes so env-dependent labels stay current
document.getElementById('inp-api-env').addEventListener('change', () => {
  if (state.selectedAudit) renderPipeline(state.selectedAudit);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('url-list-modal');
    if (modal && modal.style.display !== 'none') modal.style.display = 'none';
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVal(id) { return (document.getElementById(id) || {}).value || ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function pad(n) { return String(n).padStart(2, '0'); }
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(s) { return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.id === `tab-btn-${tabId}`);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === `pane-${tabId}`);
  });
  if (tabId === 'mystique') {
    const notify = document.getElementById('mystique-tab-notify');
    if (notify) notify.classList.remove('visible');
  }
}

function showMystiqueTab() {
  switchTab('mystique');
}

// ─── Results panel ────────────────────────────────────────────────────────────

function hideResultsPanel() {
  // Clear notification badge and mystique content
  const notify = document.getElementById('mystique-tab-notify');
  if (notify) notify.classList.remove('visible');
  const content = document.getElementById('results-mystique-content');
  if (content) content.innerHTML = '';
  const summary = document.getElementById('results-audit-summary');
  if (summary) summary.innerHTML = '';
  const statusBadge = document.getElementById('results-mystique-status');
  if (statusBadge) { statusBadge.className = 'results-poll-badge'; statusBadge.textContent = ''; }
  // Return to audit tab
  switchTab('audit');
  if (state.mystiquePoller) {
    clearInterval(state.mystiquePoller);
    state.mystiquePoller = null;
  }
}

async function loadResults(jobId) {
  // Parse the audit output buffer and populate the results pane
  const summary = await fetchAuditSummary(jobId);
  renderAuditSummary(summary);

  // Start polling — stay on terminal tab; badge on Mystique tab will notify when ready
  startMystiquePoller();
}

async function fetchAuditSummary(jobId) {
  try {
    const res = await fetch(`/api/results/job/${jobId}`);
    if (!res.ok) return null;
    const { lines } = await res.json();
    return parseAuditLines(lines);
  } catch {
    return null;
  }
}

function parseAuditLines(lines) {
  const summary = { brokenLinksCount: null, altUrlsCount: null, messageSent: false, messageId: null, sqsError: false };
  for (const line of (lines || [])) {
    const m = line.match(/Summary: (\d+) broken links?, (\d+) alternative URLs?/);
    if (m) { summary.brokenLinksCount = parseInt(m[1], 10); summary.altUrlsCount = parseInt(m[2], 10); }
    const sent = line.match(/Message sent to Localstack SQS \(MessageId: ([^)]+)\)/);
    if (sent) { summary.messageSent = true; summary.messageId = sent[1]; }
    if (line.includes('Failed to send to Localstack SQS')) summary.sqsError = true;
  }
  return summary;
}

function renderAuditSummary(summary) {
  const el = document.getElementById('results-audit-summary');
  if (!el) return;
  if (!summary) {
    el.innerHTML = '<div class="results-no-data">Could not parse audit output.</div>';
    return;
  }
  const parts = [];
  if (summary.brokenLinksCount !== null) {
    parts.push(`<span class="results-stat"><strong>${summary.brokenLinksCount}</strong> broken links sent to Mystique</span>`);
  }
  if (summary.altUrlsCount !== null) {
    parts.push(`<span class="results-stat"><strong>${summary.altUrlsCount}</strong> alternative URLs provided</span>`);
  }
  if (summary.messageSent) {
    parts.push(`<span class="results-stat ok">&#10003; SQS message queued</span>`);
    if (summary.messageId) {
      parts.push(`<span class="results-stat dim">${summary.messageId.substring(0, 8)}…</span>`);
    }
  } else if (summary.sqsError) {
    parts.push(`<span class="results-stat err">&#10007; SQS send failed — is Localstack running?</span>`);
  }
  el.innerHTML = parts.length
    ? `<div class="results-stats-row">${parts.join('')}</div>`
    : '<div class="results-no-data">No summary found in audit output.</div>';
}

let _mystiqueAttempts = 0;
const MYSTIQUE_MAX_ATTEMPTS = 120; // 10 min at 5s intervals

function startMystiquePoller() {
  _mystiqueAttempts = 0;
  setMystiqueStatus('polling');
  if (state.mystiquePoller) { clearInterval(state.mystiquePoller); state.mystiquePoller = null; }
  pollMystiqueOnce();
  state.mystiquePoller = setInterval(() => {
    _mystiqueAttempts++;
    if (_mystiqueAttempts >= MYSTIQUE_MAX_ATTEMPTS) {
      clearInterval(state.mystiquePoller);
      state.mystiquePoller = null;
      setMystiqueStatus('timeout');
      return;
    }
    pollMystiqueOnce();
  }, 5000);
}

async function pollMystiqueOnce() {
  try {
    const res = await fetch('/api/results/mystique');
    const data = await res.json();
    if (data.error && !data.messages?.length) {
      setMystiqueStatus('error', data.error);
      return;
    }
    if (data.messages?.length) {
      if (state.mystiquePoller) { clearInterval(state.mystiquePoller); state.mystiquePoller = null; }
      setMystiqueStatus('done');
      renderMystiqueSuggestions(data.messages);
    }
  } catch { /* keep polling */ }
}

function pollMystiqueNow() {
  pollMystiqueOnce();
  if (!state.mystiquePoller) startMystiquePoller();
}

function setMystiqueStatus(status, error = '') {
  const badge = document.getElementById('results-mystique-status');
  const content = document.getElementById('results-mystique-content');
  if (status === 'polling') {
    if (badge) { badge.className = 'results-poll-badge polling'; badge.textContent = 'Waiting for Mystique\u2026'; }
    if (content) content.innerHTML = '<div class="results-waiting">Polling for Mystique results every 5 seconds\u2026<br><small>Mystique processes asynchronously \u2014 this can take a few minutes.</small></div>';
  } else if (status === 'done') {
    if (badge) { badge.className = 'results-poll-badge done'; badge.textContent = 'Results ready'; }
    // Notify the Mystique tab button with a pulsing dot
    const notify = document.getElementById('mystique-tab-notify');
    if (notify) notify.classList.add('visible');
  } else if (status === 'error') {
    if (badge) { badge.className = 'results-poll-badge error'; badge.textContent = 'Localstack error'; }
    if (content) content.innerHTML = `<div class="results-error">Cannot reach Localstack: ${escHtml(error)}<br><small>Is Mystique running? Start with: <code>cd mystique &amp;&amp; docker-compose up localstack</code></small></div>`;
  } else if (status === 'timeout') {
    if (badge) { badge.className = 'results-poll-badge error'; badge.textContent = 'Timed out'; }
    if (content) content.innerHTML = '<div class="results-error">No Mystique results after 10 minutes. Click Refresh to try again.</div>';
  }
}

function renderMystiqueSuggestions(messages) {
  const content = document.getElementById('results-mystique-content');
  if (!content) return;

  const allLinks = [];
  for (const msg of messages) {
    for (const link of (msg?.data?.brokenLinks || [])) {
      allLinks.push(link);
    }
  }

  if (!allLinks.length) {
    content.innerHTML = '<div class="results-no-data">Mystique returned no suggestions in the queue.</div>';
    return;
  }

  const truncUrl = (u, max = 55) => {
    if (!u) return '';
    try { u = decodeURIComponent(u); } catch { /* ok */ }
    return u.length > max ? '\u2026' + u.slice(-(max - 1)) : u;
  };

  const urlCell = (u) => u
    ? `<a href="${escHtml(u)}" target="_blank" title="${escHtml(u)}">${escHtml(truncUrl(u))}</a>`
    : '<span style="color:var(--text-dim)">—</span>';

  const rows = allLinks.map((link) => {
    const suggestions = link.suggestedUrls || [];
    const best = suggestions[0] || '';
    const moreCount = suggestions.length - 1;
    const suggCell = best
      ? `<div class="sugg-cell">${urlCell(best)}${moreCount > 0 ? `<span class="dim">+${moreCount} more</span>` : ''}</div>`
      : '<span class="sugg-none">No suggestion</span>';
    const rationale = link.aiRationale || '';
    const ratTrunc = rationale.length > 140 ? rationale.slice(0, 140) + '\u2026' : rationale;
    return `<tr>
      <td>${urlCell(link.urlFrom)}</td>
      <td>${urlCell(link.urlTo)}</td>
      <td>${suggCell}</td>
      <td class="rationale-cell" title="${escHtml(rationale)}">${escHtml(ratTrunc)}</td>
    </tr>`;
  }).join('');

  content.innerHTML = `
    <div class="results-count">${allLinks.length} suggestion${allLinks.length !== 1 ? 's' : ''} from Mystique</div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr><th>Referring Page</th><th>Broken URL</th><th>AI Suggestion</th><th>Rationale</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ─── Kick off ─────────────────────────────────────────────────────────────────

boot();
