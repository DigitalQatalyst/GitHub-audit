require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { runAudit } = require('./audit/scanner');
const { saveScan, loadLatestScan, listScanHistory } = require('./audit/storage');
const { buildOrganisationSummary } = require('./audit/descriptions');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

let scanState = {
  status: 'idle',
  message: 'Ready — click Refresh to start a scan',
  progress: null,
  lastError: null,
};

let scheduledJob = null;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

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

app.use('/api', basicAuth);
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/config', (req, res) => {
  res.json({
    accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
    defaultMode: process.env.DEFAULT_SCAN_MODE || 'fast',
    hasServerPat: Boolean(process.env.GITHUB_PAT),
    authEnabled: Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD),
    cronEnabled: Boolean(scheduledJob),
    cronExpression: process.env.AUDIT_CRON || '0 6 * * *',
  });
});

app.get('/api/status', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  res.json({
    ...scanState,
    lastScan: latest ? {
      completedAt: latest.completedAt,
      rateLimitRemaining: latest.rateLimitRemaining,
      summary: latest.summary,
    } : null,
  });
});

app.get('/api/scan/latest', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) return res.status(404).json({ error: 'No scan results yet' });
  const orgReport = buildOrganisationSummary(latest);
  res.json({ ...latest, orgReport });
});

app.get('/api/scan/history', (req, res) => {
  res.json({ files: listScanHistory(DATA_DIR) });
});

app.get('/api/export/json', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) return res.status(404).json({ error: 'No scan results' });
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
  res.json(latest);
});

app.get('/api/export/csv', (req, res) => {
  const latest = loadLatestScan(DATA_DIR);
  if (!latest) return res.status(404).json({ error: 'No scan results' });

  const headers = [
    'Repository', 'Health', 'Visibility', 'Last Push', 'Commits 7d',
    'Vague Commit %', 'Branches', 'Non-compliant Branches',
    'Open PRs', 'Stalled PRs', 'PRs No Reviewers', 'Risks', 'Summary',
  ];

  const rows = latest.repositories.map((r) => [
    r.fullName,
    r.healthLabel,
    r.visibility,
    r.activity?.lastPush,
    r.activity?.commits7d,
    r.commitHygiene?.vaguePct,
    r.branches?.total,
    r.branches?.nonCompliant,
    r.prWorkflow?.open,
    r.prWorkflow?.stalled,
    r.prWorkflow?.noReviewers,
    r.risks?.map((x) => x.label).join('; '),
    r.summary,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
  res.send(csv);
});

app.post('/api/scan', async (req, res) => {
  if (scanState.status === 'running') {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  const {
    pat: bodyPat,
    accountFilter = process.env.AUDIT_ACCOUNT_FILTER || '',
    scope = 'all',
    mode = process.env.DEFAULT_SCAN_MODE || 'fast',
  } = req.body;

  const pat = bodyPat || process.env.GITHUB_PAT;
  if (!pat) {
    return res.status(400).json({ error: 'GitHub PAT is required. Provide in request or set GITHUB_PAT env var.' });
  }

  scanState = { status: 'running', message: 'Starting scan...', progress: null, lastError: null };
  res.json({ status: 'started' });

  try {
    const scan = await runAudit({
      pat,
      accountFilter,
      scope,
      mode,
      onProgress: ({ message, detail }) => {
        scanState.message = message;
        scanState.progress = detail;
      },
    });

    scan.orgReport = buildOrganisationSummary(scan);
    saveScan(DATA_DIR, scan);

    scanState = {
      status: 'complete',
      message: `Scan complete — ${scan.summary.visibleRepos} repositories`,
      progress: null,
      lastError: null,
      completedAt: scan.completedAt,
      rateLimitRemaining: scan.rateLimitRemaining,
    };
  } catch (err) {
    scanState = {
      status: 'error',
      message: 'Scan failed',
      progress: null,
      lastError: err.message,
    };
  }
});

app.post('/api/actions/:actionId', basicAuth, (req, res) => {
  const { repo } = req.body;
  const { actionId } = req.params;

  const guidance = {
    'enforce-protection': `To enforce protection on ${repo}: go to Settings → Branches → Add rule for main/develop/staging requiring PR reviews.`,
    'add-contributing': `Create CONTRIBUTING.md in ${repo} with branch naming rules (feature/description-dev, bugfix/description-dev) and PR review requirements.`,
    'fix-branch-names': `Rename non-compliant branches in ${repo} using: git branch -m old-name feature/new-name-dev && git push origin -u feature/new-name-dev`,
    'triage-prs': `Review open PRs in ${repo}: assign reviewers, merge completed work, or close abandoned PRs.`,
  };

  res.json({
    actionId,
    repo,
    status: 'guidance',
    message: guidance[actionId] || 'Action recorded. Manual remediation required via GitHub UI or API.',
  });
});

function startScheduler() {
  const cronExpr = process.env.AUDIT_CRON;
  if (!cronExpr || !process.env.GITHUB_PAT) return;

  if (!cron.validate(cronExpr)) {
    console.warn(`Invalid AUDIT_CRON expression: ${cronExpr}`);
    return;
  }

  scheduledJob = cron.schedule(cronExpr, async () => {
    if (scanState.status === 'running') return;
    console.log(`[${new Date().toISOString()}] Scheduled audit starting...`);
    scanState = { status: 'running', message: 'Scheduled scan...', progress: null, lastError: null };

    try {
      const scan = await runAudit({
        pat: process.env.GITHUB_PAT,
        accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
        scope: 'all',
        mode: process.env.DEFAULT_SCAN_MODE || 'fast',
        onProgress: ({ message, detail }) => {
          scanState.message = message;
          scanState.progress = detail;
        },
      });
      scan.orgReport = buildOrganisationSummary(scan);
      saveScan(DATA_DIR, scan);
      scanState = {
        status: 'complete',
        message: `Scheduled scan complete — ${scan.summary.visibleRepos} repos`,
        progress: null,
        lastError: null,
      };
      console.log(`Scheduled audit complete: ${scan.summary.critical} critical, ${scan.summary.warning} warning`);
    } catch (err) {
      scanState = { status: 'error', message: 'Scheduled scan failed', lastError: err.message };
      console.error('Scheduled audit failed:', err.message);
    }
  });

  console.log(`Daily audit scheduled: ${cronExpr}`);
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`GitHub Audit Dashboard running at http://localhost:${PORT}`);
  if (process.env.DASHBOARD_USER) console.log('Basic auth enabled');
  if (process.env.GITHUB_PAT) console.log('Server-side PAT configured');
  startScheduler();
});
