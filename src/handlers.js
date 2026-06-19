require('dotenv').config();

const { getServerPat, getDataDir } = require('./config');

let _scanner;
let _storage;
let _descriptions;
let _teamsReport;

function lazyScanner() {
  if (!_scanner) _scanner = require('./audit/scanner');
  return _scanner;
}

function lazyStorage() {
  if (!_storage) _storage = require('./audit/storage');
  return _storage;
}

function lazyDescriptions() {
  if (!_descriptions) _descriptions = require('./audit/descriptions');
  return _descriptions;
}

function lazyTeamsReport() {
  if (!_teamsReport) _teamsReport = require('./audit/teamsReport');
  return _teamsReport;
}

function attachReports(scan) {
  const { buildOrganisationSummary } = lazyDescriptions();
  const { buildTeamsReport } = lazyTeamsReport();
  return {
    ...scan,
    orgReport: buildOrganisationSummary(scan),
    teamsReport: buildTeamsReport(scan),
  };
}

function dataDir() {
  return getDataDir();
}

function getConfig() {
  return {
    accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
    defaultMode: process.env.DEFAULT_SCAN_MODE || 'fast',
    hasServerPat: Boolean(getServerPat()),
    authEnabled: Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD),
  };
}

function getStatus() {
  const { loadLatestScan } = lazyStorage();
  const latest = loadLatestScan(dataDir());
  return {
    status: latest ? 'complete' : 'idle',
    message: latest ? 'Last scan available' : 'Ready — click Refresh to start a scan',
    lastScan: latest ? {
      completedAt: latest.completedAt,
      rateLimitRemaining: latest.rateLimitRemaining,
      summary: latest.summary,
    } : null,
  };
}

function getLatestScan() {
  const { loadLatestScan } = lazyStorage();
  const latest = loadLatestScan(dataDir());
  if (!latest) {
    return { status: 'empty', repositories: [], summary: null, orgReport: null, teamsReport: null };
  }
  return attachReports(latest);
}

function listScanHistory() {
  const { listScanHistory: list } = lazyStorage();
  return list(dataDir());
}

function getExportJson() {
  const { loadLatestScan } = lazyStorage();
  const latest = loadLatestScan(dataDir());
  if (!latest) return { error: 'No scan results yet. Run a scan first.', status: 404 };
  return { data: latest };
}

function getExportCsv() {
  const { loadLatestScan } = lazyStorage();
  const latest = loadLatestScan(dataDir());
  if (!latest) return { error: 'No scan results yet. Run a scan first.', status: 404 };

  const headers = [
    'Repository', 'Health', 'Visibility', 'Last Push', 'Commits 7d',
    'Vague Commit %', 'Branches', 'Non-compliant Branches',
    'Open PRs', 'Stalled PRs', 'PRs No Reviewers', 'Risks', 'Summary',
  ];

  const rows = latest.repositories.map((r) => [
    r.fullName, r.healthLabel, r.visibility, r.activity?.lastPush,
    r.activity?.commits7d, r.commitHygiene?.vaguePct, r.branches?.total,
    r.branches?.nonCompliant, r.prWorkflow?.open, r.prWorkflow?.stalled,
    r.prWorkflow?.noReviewers, r.risks?.map((x) => x.label).join('; '), r.summary,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return { csv };
}

function getTeamsReport() {
  const { loadLatestScan } = lazyStorage();
  const { buildTeamsReport } = lazyTeamsReport();
  const latest = loadLatestScan(dataDir());
  if (!latest) return { error: 'No scan results yet. Run a scan first.', status: 404 };
  return { text: buildTeamsReport(latest) };
}

async function runScan(body = {}) {
  const {
    pat: bodyPat,
    accountFilter = process.env.AUDIT_ACCOUNT_FILTER || '',
    scope = 'all',
    mode = process.env.DEFAULT_SCAN_MODE || 'fast',
  } = body;

  const pat = bodyPat || getServerPat();
  if (!pat) {
    return {
      error: 'GitHub PAT is required. Enter a token above or add PAT in Vercel Environment Variables.',
      status: 400,
    };
  }

  const { runAudit } = lazyScanner();
  const { saveScan } = lazyStorage();

  const scan = await runAudit({ pat, accountFilter, scope, mode, onProgress: () => {} });
  const withReports = attachReports(scan);
  saveScan(dataDir(), scan);

  return {
    status: 'complete',
    message: `Scan complete — ${scan.summary.visibleRepos} active repositories`,
    ...withReports,
  };
}

async function runDailyCron(headers = {}) {
  if (headers['x-vercel-cron'] !== '1' || !getServerPat()) {
    return { error: 'Unauthorized', status: 401 };
  }
  return runScan({});
}

function getActionGuidance(actionId, repo) {
  const guidance = {
    'enforce-protection': `On ${repo}: Settings → Branches → add protection rules requiring pull request reviews.`,
    'add-contributing': `Add CONTRIBUTING.md to ${repo} with branch naming and PR review guidelines.`,
    'fix-branch-names': `Rename branches in ${repo} to feature/description-developer or bugfix/description-developer.`,
    'triage-prs': `Review open PRs in ${repo}: assign reviewers, merge or close stale PRs.`,
  };
  return { actionId, repo, status: 'guidance', message: guidance[actionId] || 'Manual remediation required via GitHub.' };
}

module.exports = {
  getConfig, getStatus, getLatestScan, listScanHistory,
  getExportJson, getExportCsv, getTeamsReport,
  runScan, runDailyCron, getActionGuidance,
};
