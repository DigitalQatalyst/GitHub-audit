require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const handlers = require('./handlers');
const { getServerPat, isVercel } = require('./config');

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
    res.setHeader('WWW-Authenticate', 'Basic realm="GitHub Audit Dashboard"');
    return res.status(401).json({ error: 'Authentication required' });
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [u, p] = decoded.split(':');
  if (u !== user || p !== pass) return res.status(401).json({ error: 'Invalid credentials' });
  next();
}

const api = express.Router();
api.use(basicAuth);

api.get('/health', (req, res) => res.json({ ok: true, hasPat: Boolean(getServerPat()), platform: 'node' }));
api.get('/config', (req, res) => res.json(handlers.getConfig()));
api.get('/status', async (req, res) => res.json(await handlers.getStatus()));
api.get('/latest', async (req, res) => res.json(await handlers.getLatestScan()));
api.get('/scan/latest', async (req, res) => res.json(await handlers.getLatestScan()));
api.get('/scan/history', (req, res) => res.json({ files: handlers.listScanHistory() }));

api.get('/export-json', async (req, res) => {
  const result = await handlers.getExportJson();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
  res.json(result.data);
});

api.get('/export-csv', async (req, res) => {
  const result = await handlers.getExportCsv();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
  res.send(result.csv);
});

api.get('/export/json', async (req, res) => {
  const result = await handlers.getExportJson();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
  res.json(result.data);
});

api.get('/export/csv', async (req, res) => {
  const result = await handlers.getExportCsv();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
  res.send(result.csv);
});

api.post('/scan', async (req, res) => {
  try {
    const result = await handlers.runScan(req.body);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/cron/daily', async (req, res) => {
  const result = await handlers.runDailyCron(req.headers);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

api.post('/actions/:actionId', (req, res) => {
  res.json(handlers.getActionGuidance(req.params.actionId, req.body?.repo));
});

app.use('/api', api);

if (!isVercel()) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

module.exports = app;
