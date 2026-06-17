require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { runAudit } = require('./audit/scanner');
const { saveScan, loadLatestScan, listScanHistory } = require('./audit/storage');
const { buildOrganisationSummary } = require('./audit/descriptions');
const { getServerPat, getDataDir, isVercel } = require('./config');

const DATA_DIR = getDataDir();
const PUBLIC_DIR = path.join(__dirname, '../public');

const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));

function basicAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="GitHub Audit Dashboard"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [u, p] = decoded.split(':');
  if (u !== user || p !== pass) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  next();
}

const api = express.Router();
api.use(basicAuth);

api.get('/health', (req, res) => {
  res.json({ ok: true, hasPat: Boolean(getServerPat()), platform: isVercel() ? 'vercel' : 'node' });
});

api.get('/config', (req, res) => {
  res.json({
    accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
    defaultMode: process.env.DEFAULT_SCAN_MODE || 'fast',
    hasServerPat: Boolean(getServerPat()),
    authEnabled: Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD),
    platform: isVercel() ? 'vercel' : 'node',
  });
});

api.get('/status', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  res.json({
    status: latest ? 'complete' : 'idle',
    message: latest ? 'Last scan available' : 'Ready — click Refresh to start a scan',
    lastScan: latest ? {
      completedAt: latest.completedAt,
      rateLimitRemaining: latest.rateLimitRemaining,
      summary: latest.summary,
    } : null,
  });
});

api.get('/scan/latest', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) {
    return res.json({ status: 'empty', repositories: [], summary: null, orgReport: null });
  }
  const orgReport = buildOrganisationSummary(latest);
  res.json({ ...latest, orgReport });
});

api.get('/scan/history', (req, res) => {
  res.json({ files: listScanHistory(DATA_DIR) });
});

api.get('/export/json', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) return res.status(404).json({ error: 'No scan results yet. Run a scan first.' });
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
  res.json(latest);
});

api.get('/export/csv', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) return res.status(404).json({ error: 'No scan results yet. Run a scan first.' });

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

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
  res.send(csv);
});

/** Synchronous scan — required for Vercel serverless (no background work after response). */
api.post('/scan', async (req, res) => {
  const {
    pat: bodyPat,
    accountFilter = process.env.AUDIT_ACCOUNT_FILTER || '',
    scope = 'all',
    mode = process.env.DEFAULT_SCAN_MODE || 'fast',
  } = req.body;

  const pat = bodyPat || getServerPat();
  if (!pat) {
    return res.status(400).json({
      error: 'GitHub PAT is required. Enter a token above or add PAT in Vercel Environment Variables.',
    });
  }

  try {
    const scan = await runAudit({
      pat,
      accountFilter,
      scope,
      mode,
      onProgress: () => {},
    });

    scan.orgReport = buildOrganisationSummary(scan);
    saveScan(DATA_DIR, scan);

    res.json({
      status: 'complete',
      message: `Scan complete — ${scan.summary.visibleRepos} active repositories`,
      ...scan,
      orgReport: scan.orgReport,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Scan failed' });
  }
});

/** Vercel Cron daily audit */
api.get('/cron/daily', async (req, res) => {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const pat = getServerPat();
  if (!isVercelCron || !pat) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const scan = await runAudit({
      pat,
      accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
      scope: 'all',
      mode: process.env.DEFAULT_SCAN_MODE || 'fast',
    });
    scan.orgReport = buildOrganisationSummary(scan);
    saveScan(DATA_DIR, scan);
    res.json({ status: 'complete', summary: scan.summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/actions/:actionId', (req, res) => {
  const { repo } = req.body;
  const { actionId } = req.params;

  const guidance = {
    'enforce-protection': `On ${repo}: Settings → Branches → add protection rules on main/develop/staging requiring pull request reviews.`,
    'add-contributing': `Add CONTRIBUTING.md to ${repo} explaining branch naming (feature/description-dev) and PR review rules.`,
    'fix-branch-names': `Rename branches in ${repo} to the standard format: feature/description-developer or bugfix/description-developer.`,
    'triage-prs': `Review open PRs in ${repo}: assign reviewers, merge finished work, or close abandoned PRs.`,
  };

  res.json({
    actionId, repo, status: 'guidance',
    message: guidance[actionId] || 'Manual remediation required via GitHub.',
  });
});

app.use('/api', api);

// Local dev: serve static files. On Vercel, public/ is served automatically.
if (!isVercel()) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

module.exports = app;
