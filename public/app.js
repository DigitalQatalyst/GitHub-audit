/**
 * GitHub Governance Dashboard — client application
 */

let currentScan = null;
let pollTimer = null;

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('Cannot reach the audit server. Run npm start and open the dashboard from that server.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404 && path !== '/scan/latest') {
      throw new Error(err.error || 'API endpoint not found. Ensure the Node server is running (npm start).');
    }
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function setStatus(status, text, meta = '') {
  const badge = $('#status-badge');
  badge.textContent = status;
  badge.className = `badge badge-${status}`;
  $('#status-text').textContent = text;
  $('#status-meta').textContent = meta;
}

async function loadConfig() {
  try {
    const cfg = await api('/config');
    if (cfg.accountFilter) $('#account').value = cfg.accountFilter;
    if (cfg.defaultMode) $('#mode').value = cfg.defaultMode;

    const note = $('#pat-note');
    if (cfg.hasServerPat) {
      note.textContent = 'PAT is saved on server — you can refresh without entering a token.';
    } else {
      note.textContent = 'PAT is not saved. Enter a token to scan, or configure the PAT secret on the server.';
    }

    if (cfg.cronEnabled) {
      $('#refresh-mode').value = 'auto';
    }
  } catch { /* offline */ }
}

async function pollStatus() {
  try {
    const st = await api('/status');
    if (st.status === 'running') {
      setStatus('running', st.message, st.progress || '');
      $('#btn-refresh').disabled = true;
      pollTimer = setTimeout(pollStatus, 2000);
    } else if (st.status === 'complete') {
      setStatus('complete', st.message, buildMeta(st.lastScan));
      $('#btn-refresh').disabled = false;
      clearTimeout(pollTimer);
      await loadLatestScan();
    } else if (st.status === 'error') {
      setStatus('error', st.lastError || 'Scan failed', '');
      $('#btn-refresh').disabled = false;
      clearTimeout(pollTimer);
    } else if (st.lastScan) {
      setStatus('complete', 'Last scan loaded', buildMeta(st.lastScan));
      try { await loadLatestScan(); } catch { /* no results file yet */ }
    } else {
      setStatus('idle', 'Ready — click Refresh to start a scan', '');
    }
  } catch (err) {
    setStatus('error', err.message, '');
  }
}

function buildMeta(lastScan) {
  if (!lastScan) return '';
  return `Last scan: ${formatDate(lastScan.completedAt)} · Rate remaining: ${lastScan.rateLimitRemaining ?? '—'}`;
}

async function loadLatestScan() {
  const scan = await api('/scan/latest');
  if (!scan.repositories?.length) return;
  currentScan = scan;
  renderDashboard(currentScan);
}

function renderDashboard(scan) {
  if (!scan?.summary) return;

  $('#org-summary').classList.remove('hidden');
  $('#kpi-section').classList.remove('hidden');
  $('#charts-section').classList.remove('hidden');
  $('#table-section').classList.remove('hidden');

  const s = scan.summary;
  $('#kpi-repos').textContent = s.visibleRepos;
  $('#kpi-critical').textContent = s.critical;
  $('#kpi-warning').textContent = s.warning;
  $('#kpi-healthy').textContent = s.healthy;
  $('#kpi-stale').textContent = s.staleRepos;
  $('#kpi-pr-risks').textContent = s.openPrRisks;
  $('#kpi-naming').textContent = s.namingViolations;
  $('#kpi-protection').textContent = s.protectionUnknown;

  if (scan.orgReport) {
    $('#org-assessment').textContent = scan.orgReport.overallAssessment;
    const findingsEl = $('#org-findings');
    findingsEl.innerHTML = (scan.orgReport.keyFindings || []).map((f) => `
      <div class="finding-card ${f.severity === 'Warning' ? 'warning' : ''}">
        <h4>${f.finding}</h4>
        <div class="count">${f.count}</div>
        <p>${f.description}</p>
      </div>
    `).join('');
  }

  renderHealthBars(s);
  renderOwners(scan.owners || []);
  renderRepoTable(scan.repositories || []);
}

function renderHealthBars(s) {
  const total = s.visibleRepos || 1;
  const bars = [
    { label: 'Critical', count: s.critical, cls: 'critical' },
    { label: 'Warning', count: s.warning, cls: 'warning' },
    { label: 'Healthy', count: s.healthy, cls: 'healthy' },
  ];
  $('#health-bars').innerHTML = bars.map((b) => `
    <div class="health-bar-row">
      <span class="health-bar-label">${b.label}</span>
      <div class="health-bar-track">
        <div class="health-bar-fill ${b.cls}" style="width: ${(b.count / total) * 100}%"></div>
      </div>
      <span class="health-bar-count">${b.count}</span>
    </div>
  `).join('');
}

function renderOwners(owners) {
  $('#owner-list').innerHTML = owners.map((o) => `
    <li><span>${o.name}</span><span>${o.count}</span></li>
  `).join('');
}

function renderRepoTable(repos) {
  const search = ($('#repo-search')?.value || '').toLowerCase();
  const healthFilter = $('#health-filter')?.value || '';

  const filtered = repos.filter((r) => {
    if (healthFilter && r.health !== healthFilter) return false;
    if (search && !r.fullName.toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = $('#repo-tbody');
  tbody.innerHTML = filtered.map((r) => `
    <tr data-repo="${r.fullName}">
      <td>
        <div class="repo-name" data-action="detail">${r.fullName}</div>
        <div class="repo-meta">${r.visibility} / ${r.defaultBranch}</div>
      </td>
      <td><span class="health-badge ${r.health}">${r.healthLabel}</span></td>
      <td class="cell-muted">${r.activity?.display || '—'}</td>
      <td>
        <div>${r.commitHygiene?.display || '—'}</div>
        ${r.commitHygiene?.samples?.length ? `<div class="cell-muted">e.g. "${r.commitHygiene.samples[0]}"</div>` : ''}
      </td>
      <td class="cell-muted">${r.branches?.display || '—'}</td>
      <td class="cell-muted">${r.prWorkflow?.display || '—'}</td>
      <td class="cell-muted">${r.protection?.summary || '—'}</td>
      <td class="cell-muted">${r.docs?.display || '—'}</td>
      <td>
        ${(r.risks || []).map((risk) => `
          <span class="risk-pill" title="${risk.summary || ''} — ${risk.action || ''}">${risk.label}</span>
        `).join('')}
      </td>
      <td>
        ${(r.actions || []).map((a) => `
          <button class="btn-action" data-action="${a.id}" data-repo="${r.fullName}">${a.label}</button>
        `).join('')}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-action="detail"]').forEach((el) => {
    el.addEventListener('click', () => {
      const repo = el.closest('tr').dataset.repo;
      showRepoDetail(repos.find((r) => r.fullName === repo));
    });
  });

  tbody.querySelectorAll('.btn-action').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.repo));
  });
}

function showRepoDetail(repo) {
  if (!repo) return;
  $('#modal-title').textContent = repo.fullName;
  $('#modal-summary').textContent = repo.summary || '';

  $('#modal-risks').innerHTML = `
    <div class="modal-section">
      <h3>Key Risks</h3>
      <ul>${(repo.risks || []).map((r) => `
        <li><strong>${r.label}</strong> — ${r.summary} <em>${r.action}</em></li>
      `).join('') || '<li>No risks detected</li>'}</ul>
    </div>
  `;

  const branchSamples = repo.branches?.samples || [];
  $('#modal-branches').innerHTML = branchSamples.length ? `
    <div class="modal-section">
      <h3>Non-Compliant Branches (sample)</h3>
      <ul>${branchSamples.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>
  ` : '';

  const commitSamples = repo.commitHygiene?.samples || [];
  $('#modal-commits').innerHTML = commitSamples.length ? `
    <div class="modal-section">
      <h3>Vague Commit Examples</h3>
      <ul>${commitSamples.map((c) => `<li>"${c}"</li>`).join('')}</ul>
    </div>
  ` : '';

  $('#detail-modal').classList.remove('hidden');
}

async function handleAction(actionId, repo) {
  try {
    const result = await api(`/actions/${actionId}`, {
      method: 'POST',
      body: JSON.stringify({ repo }),
    });
    showToast(result.message);
  } catch (err) {
    showToast(err.message);
  }
}

async function startScan() {
  const pat = $('#pat').value.trim();
  const accountFilter = $('#account').value.trim();
  const scope = $('#scope').value;
  const mode = $('#mode').value;

  $('#btn-refresh').disabled = true;
  setStatus('running', 'Starting scan...', '');

  try {
    await api('/scan', {
      method: 'POST',
      body: JSON.stringify({ pat: pat || undefined, accountFilter, scope, mode }),
    });
    pollTimer = setTimeout(pollStatus, 1500);
  } catch (err) {
    setStatus('error', err.message, '');
    $('#btn-refresh').disabled = false;
    showToast(err.message);
  }
}

function exportFile(type) {
  window.open(`/api/export/${type}`, '_blank');
}

function init() {
  $('#btn-refresh').addEventListener('click', startScan);
  $('#btn-json').addEventListener('click', () => exportFile('json'));
  $('#btn-csv').addEventListener('click', () => exportFile('csv'));
  $('#repo-search').addEventListener('input', () => {
    if (currentScan) renderRepoTable(currentScan.repositories);
  });
  $('#health-filter').addEventListener('change', () => {
    if (currentScan) renderRepoTable(currentScan.repositories);
  });
  $('#modal-close').addEventListener('click', () => $('#detail-modal').classList.add('hidden'));
  $('#detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') $('#detail-modal').classList.add('hidden');
  });

  loadConfig();
  pollStatus();
}

document.addEventListener('DOMContentLoaded', init);
