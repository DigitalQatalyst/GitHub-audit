require('dotenv').config();
const { runAudit } = require('./audit/scanner');
const { saveScan, loadLatestScan, listScanHistory } = require('./audit/storage');
const { buildOrganisationSummary } = require('./audit/descriptions');
const { getServerPat, getDataDir, isVercel } = require('./config');

const DATA_DIR = getDataDir();

function getConfig() {
  return {
    accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
    defaultMode: process.env.DEFAULT_SCAN_MODE || 'fast',
    hasServerPat: Boolean(getServerPat()),
    authEnabled: Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD),
    platform: isVercel() ? 'vercel' : 'node',
  };
}

function getStatus() {
  const latest = loadLatestScan(DATA_DIR);
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
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) {
    return { status: 'empty', repositories: [], summary: null, orgReport: null };
  }
  const orgReport = buildOrganisationSummary(latest);
  return { ...latest, orgReport };
}

function getExportJson() {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) return { error: 'No scan results yet. Run a scan first.', status: 404 };
  return { data: latest };
}

function getExportCsv() {
  const latest = loadLatestScan(DATA_DIR);
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

  const scan = await runAudit({ pat, accountFilter, scope, mode, onProgress: () => {} });
  scan.orgReport = buildOrganisationSummary(scan);
  saveScan(DATA_DIR, scan);

  return {
    status: 'complete',
    message: `Scan complete — ${scan.summary.visibleRepos} active repositories`,
    ...scan,
    orgReport: scan.orgReport,
  };
}

async function runDailyCron(headers = {}) {
  const isVercelCron = headers['x-vercel-cron'] === '1';
  const pat = getServerPat();
  if (!isVercelCron || !pat) {
    return { error: 'Unauthorized', status: 401 };
  }

  const scan = await runAudit({
    pat,
    accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
    scope: 'all',
    mode: process.env.DEFAULT_SCAN_MODE || 'fast',
  });
  scan.orgReport = buildOrganisationSummary(scan);
  saveScan(DATA_DIR, scan);
  return { status: 'complete', summary: scan.summary };
}

function getActionGuidance(actionId, repo) {
  const guidance = {
    'enforce-protection': `On ${repo}: Settings → Branches → add protection rules on main/develop/staging requiring pull request reviews.`,
    'add-contributing': `Add CONTRIBUTING.md to ${repo} explaining branch naming (feature/description-dev) and PR review rules.`,
    'fix-branch-names': `Rename branches in ${repo} to the standard format: feature/description-developer or bugfix/description-developer.`,
    'triage-prs': `Review open PRs in ${repo}: assign reviewers, merge finished work, or close abandoned PRs.`,
  };
  return {
    actionId, repo, status: 'guidance',
    message: guidance[actionId] || 'Manual remediation required via GitHub.',
  };
}

module.exports = {
  getConfig,
  getStatus,
  getLatestScan,
  getExportJson,
  getExportCsv,
  runScan,
  runDailyCron,
  getActionGuidance,
  listScanHistory: () => listScanHistory(DATA_DIR),
};
