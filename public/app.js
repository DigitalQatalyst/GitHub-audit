/**
 * GitHub Governance Dashboard — client application
 */

let currentScan = null;

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('Cannot reach the API. Check that Vercel deployment completed successfully.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function setStatus(status, text, meta = '') {
  const badge = $('#status-badge');
  badge.textContent = status === 'running' ? 'Scanning' : status;
  badge.className = `badge badge-${status}`;
  $('#status-text').textContent = text;
  $('#status-meta').textContent = meta;
}

function showLoading(show, detail = '') {
  const el = $('#loading-overlay');
  if (!el) return;
  el.classList.toggle('hidden', !show);
  if (detail) $('#loading-detail').textContent = detail;
}

function saveScanLocal(scan) {
  try {
    sessionStorage.setItem('github-audit-scan', JSON.stringify({
      completedAt: scan.completedAt,
      summary: scan.summary,
      orgReport: scan.orgReport,
      teamsReport: scan.teamsReport,
      owners: scan.owners,
      repositories: scan.repositories,
      rateLimitRemaining: scan.rateLimitRemaining,
    }));
  } catch { /* quota */ }
}

function loadScanLocal() {
  try {
    const raw = sessionStorage.getItem('github-audit-scan');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function loadConfig() {
  const cfg = await api('/config');
  if (cfg.accountFilter) $('#account').value = cfg.accountFilter;
  if (cfg.defaultMode) $('#mode').value = cfg.defaultMode;

  const note = $('#pat-note');
  const parts = [];
  if (cfg.cronDescription) parts.push(`Auto-scan: ${cfg.cronDescription}`);
  parts.push('Scans all active org repos (public + private, archived excluded)');
  note.textContent = parts.join(' · ');
  note.className = 'pat-note pat-saved';
}

async function tryLoadExistingScan() {
  try {
    const scan = await api('/latest');
    if (scan.repositories?.length) {
      currentScan = scan;
      renderDashboard(scan);
      setStatus('complete', 'Last scan loaded', buildMeta(scan));
      return true;
    }
  } catch { /* try cache */ }
  return false;
}

function buildMeta(scan) {
  if (!scan) return '';
  const parts = [];
  if (scan.completedAt) parts.push(`Last scan: ${formatDate(scan.completedAt)}`);
  if (scan.summary?.visibleRepos != null) parts.push(`${scan.summary.visibleRepos} scanned`);
  if (scan.summary?.totalDiscovered) parts.push(`${scan.summary.totalDiscovered} total`);
  if (scan.summary?.totalActive != null) parts.push(`${scan.summary.totalActive} active`);
  if (scan.summary?.archivedSkipped) parts.push(`${scan.summary.archivedSkipped} archived excluded`);
  if (scan.summary?.publicRepos != null || scan.summary?.privateRepos != null) {
    parts.push(`${scan.summary.publicRepos ?? 0} public · ${scan.summary.privateRepos ?? 0} private`);
  }
  if (scan.rateLimitRemaining != null) parts.push(`Rate remaining: ${scan.rateLimitRemaining}`);
  return parts.join(' · ');
}

function repoUrl(repo) {
  return repo.url || `https://github.com/${repo.fullName}`;
}

function renderDashboard(scan) {
  if (!scan?.summary) return;

  $('#welcome-empty').classList.add('hidden');
  $('#org-summary').classList.remove('hidden');
  $('#teams-report-section').classList.remove('hidden');
  $('#kpi-section').classList.remove('hidden');
  $('#charts-section').classList.remove('hidden');
  $('#table-section').classList.remove('hidden');

  const s = scan.summary;
  $('#kpi-total').textContent = s.totalDiscovered ?? '—';
  $('#kpi-active').textContent = s.totalActive ?? s.visibleRepos ?? '—';
  $('#kpi-repos').textContent = s.visibleRepos;
  $('#kpi-archived').textContent = s.archivedSkipped ?? '—';
  $('#kpi-critical').textContent = s.critical;
  $('#kpi-warning').textContent = s.warning;
  $('#kpi-healthy').textContent = s.healthy;
  $('#kpi-stale').textContent = s.staleRepos;
  $('#kpi-pr-risks').textContent = s.openPrRisks;
  $('#kpi-naming').textContent = s.namingViolations;
  $('#kpi-protection').textContent = s.protectionUnknown;

  if (scan.orgReport) {
    $('#org-assessment').textContent = scan.orgReport.overallAssessment;
    $('#org-findings').innerHTML = (scan.orgReport.keyFindings || []).map((f) => `
      <div class="finding-card ${f.severity === 'Warning' ? 'warning' : ''}">
        <h4>${f.finding}</h4>
        <div class="count">${f.count}</div>
        <p>${f.description}</p>
      </div>
    `).join('');
  }

  renderTeamsReport(scan.teamsReport);

  renderHealthBars(s);

  if (s.accessNote) {
    showToast(s.accessNote, 'info');
  }
  renderOwners(scan.owners || []);
  populateOwnerFilter(scan.owners || []);
  renderRepoTable(scan.repositories || []);
}

function renderTeamsReport(text) {
  const section = $('#teams-report-section');
  const field = $('#teams-report-text');
  if (!text) {
    section?.classList.add('hidden');
    if (field) field.value = '';
    return;
  }
  section.classList.remove('hidden');
  field.value = text;
}

async function copyTeamsReport() {
  const text = $('#teams-report-text')?.value;
  if (!text) {
    showToast('Run a scan first to generate the evaluation report', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Evaluation report copied — paste into Teams', 'success');
  } catch {
    $('#teams-report-text')?.select();
    showToast('Select the text and copy manually (Ctrl+C)', 'info');
  }
}

function populateOwnerFilter(owners) {
  const sel = $('#owner-filter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All owners</option>' + owners.map((o) =>
    `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)} (${o.count})</option>`
  ).join('');
  if (current) sel.value = current;
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
        <div class="health-bar-fill ${b.cls}" style="width: ${Math.max((b.count / total) * 100, b.count ? 4 : 0)}%"></div>
      </div>
      <span class="health-bar-count">${b.count}</span>
    </div>
  `).join('');
}

function renderOwners(owners) {
  $('#owner-list').innerHTML = owners.map((o) => `
    <li><span>${o.name}</span><span class="owner-count">${o.count}</span></li>
  `).join('');
}

function renderRepoTable(repos) {
  const search = ($('#repo-search')?.value || '').toLowerCase();
  const healthFilter = $('#health-filter')?.value || '';
  const ownerFilter = $('#owner-filter')?.value || '';

  const filtered = repos.filter((r) => {
    if (healthFilter && r.health !== healthFilter) return false;
    if (ownerFilter && r.owner !== ownerFilter) return false;
    if (search && !r.fullName.toLowerCase().includes(search)) return false;
    return true;
  });

  $('#repo-tbody').innerHTML = filtered.map((r) => `
    <tr data-repo="${r.fullName}">
      <td>
        <a class="repo-link" href="${escapeHtml(repoUrl(r))}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.fullName)}</a>
        <button type="button" class="repo-detail-btn" data-action="detail">What needs attention</button>
        <div class="repo-meta">${r.visibility} / ${r.defaultBranch}</div>
      </td>
      <td><span class="health-badge ${r.health}">${r.healthLabel}</span></td>
      <td class="cell-muted">${r.activity?.display || '—'}</td>
      <td>
        <div class="hygiene-rating">${r.commitHygiene?.display || '—'}</div>
        ${r.commitHygiene?.samples?.length ? `<div class="cell-muted">e.g. "${escapeHtml(r.commitHygiene.samples[0])}"</div>` : ''}
      </td>
      <td class="cell-muted">${r.branches?.display || '—'}</td>
      <td class="cell-muted">${r.prWorkflow?.display || '—'}</td>
      <td class="cell-muted protection-cell">${r.protection?.summary || '—'}</td>
      <td class="cell-muted">${r.docs?.display || '—'}</td>
      <td class="risks-cell">${renderRiskPills(r.risks)}</td>
      <td class="actions-cell">${renderActions(r.actions, r.fullName)}</td>
    </tr>
  `).join('');

  bindTableEvents(filtered);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function renderRiskPills(risks) {
  if (!risks?.length) return '<span class="cell-muted">None</span>';
  return risks.slice(0, 5).map((risk) => `
    <span class="risk-pill" title="${escapeHtml(risk.summary || '')} — ${escapeHtml(risk.action || '')}">${escapeHtml(risk.label)}</span>
  `).join('');
}

function renderActions(actions, fullName) {
  if (!actions?.length) return '<span class="cell-muted">—</span>';
  return actions.map((a) => `
    <button class="btn-action" data-action="${a.id}" data-repo="${fullName}">${a.label}</button>
  `).join('');
}

function bindTableEvents(repos) {
  const tbody = $('#repo-tbody');
  tbody.querySelectorAll('[data-action="detail"]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
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
  const url = repoUrl(repo);
  $('#modal-title').textContent = repo.fullName;
  $('#modal-summary').textContent = repo.summary || '';

  $('#modal-risks').innerHTML = `
    <div class="modal-section">
      <a class="modal-repo-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(repo.fullName)} on GitHub</a>
      <h3>What needs attention</h3>
      <ul class="risk-detail-list">${(repo.risks || []).map((r) => `
        <li>
          <strong>${escapeHtml(r.label)}</strong>
          <p>${escapeHtml(r.summary || '')}</p>
          <p class="action-hint">→ ${escapeHtml(r.action || '')}</p>
        </li>
      `).join('') || '<li>No risks detected — this repo looks healthy.</li>'}</ul>
    </div>
  `;

  const branchSamples = repo.branches?.samples || [];
  $('#modal-branches').innerHTML = branchSamples.length ? `
    <div class="modal-section">
      <h3>Non-standard branch names (sample)</h3>
      <ul>${branchSamples.map((b) => `<li><code>${escapeHtml(b)}</code></li>`).join('')}</ul>
    </div>
  ` : '';

  const commitSamples = repo.commitHygiene?.samples || [];
  $('#modal-commits').innerHTML = commitSamples.length ? `
    <div class="modal-section">
      <h3>Unclear commit messages (examples)</h3>
      <ul>${commitSamples.map((c) => `<li>"${escapeHtml(c)}"</li>`).join('')}</ul>
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
    showToast(result.message, 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function startScan() {
  const accountFilter = $('#account').value.trim();
  const scope = $('#scope').value;
  const mode = $('#mode').value;

  $('#btn-refresh').disabled = true;
  setStatus('running', 'Scanning all active org repos (public + private)…', '');
  showLoading(true, 'Listing org repositories via GitHub API…');

  try {
    const scan = await api('/scan', {
      method: 'POST',
      body: JSON.stringify({ accountFilter, scope, mode }),
    });

    currentScan = scan;
    saveScanLocal(scan);
    renderDashboard(scan);
    setStatus('complete', scan.message || 'Scan complete', buildMeta(scan));
    showToast(`Scanned ${scan.summary?.visibleRepos || 0} active repositories`, 'success');
  } catch (err) {
    setStatus('error', err.message, '');
    showToast(err.message, 'error');
  } finally {
    $('#btn-refresh').disabled = false;
    showLoading(false);
  }
}

function exportFile(type) {
  if (!currentScan && type !== 'json') {
    showToast('Run a scan first before exporting', 'error');
    return;
  }
  const path = type === 'json' ? '/export-json' : '/export-csv';
  window.open(`/api${path}`, '_blank');
}

async function init() {
  $('#btn-refresh').addEventListener('click', startScan);
  $('#btn-json').addEventListener('click', () => exportFile('json'));
  $('#btn-csv').addEventListener('click', () => exportFile('csv'));
  $('#btn-copy-teams').addEventListener('click', copyTeamsReport);
  $('#repo-search').addEventListener('input', () => {
    if (currentScan) renderRepoTable(currentScan.repositories);
  });
  $('#health-filter').addEventListener('change', () => {
    if (currentScan) renderRepoTable(currentScan.repositories);
  });
  $('#owner-filter')?.addEventListener('change', () => {
    if (currentScan) renderRepoTable(currentScan.repositories);
  });
  $('#modal-close').addEventListener('click', () => $('#detail-modal').classList.add('hidden'));
  $('#detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') $('#detail-modal').classList.add('hidden');
  });

  // Load config quietly — never show error on page load
  try {
    await loadConfig();
  } catch {
    $('#pat-note').textContent = 'Scans all non-archived DigitalQatalyst repos';
  }

  // Restore cached or server scan without blocking UI
  try {
    const loaded = await tryLoadExistingScan();
    if (!loaded) {
      setStatus('idle', 'Ready — click Refresh to start a scan', '');
    }
  } catch {
    const local = loadScanLocal();
    if (local?.repositories?.length) {
      currentScan = local;
      renderDashboard(local);
      setStatus('complete', 'Showing cached results', buildMeta(local));
    } else {
      setStatus('idle', 'Ready — click Refresh to start a scan', '');
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
