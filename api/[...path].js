/**
 * Single Vercel serverless handler for ALL /api/* routes.
 */
require('dotenv').config();

const { getServerPat, isVercel } = require('../src/config');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, data) {
  res.status(status).json(data);
}

function getRoute(req) {
  const url = (req.url || '').split('?')[0];
  if (url.startsWith('/api/')) return url.slice(5).replace(/\/$/, '');
  const segments = req.query.path;
  if (segments) return Array.isArray(segments) ? segments.join('/') : String(segments);
  return '';
}

function loadHandlers() {
  return require('../src/handlers');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = getRoute(req);

  try {
    if (route === 'health' && req.method === 'GET') {
      return json(res, 200, { ok: true, hasPat: Boolean(getServerPat()), platform: isVercel() ? 'vercel' : 'node' });
    }

    if (route === 'config' && req.method === 'GET') {
      return json(res, 200, {
        accountFilter: process.env.AUDIT_ACCOUNT_FILTER || '',
        defaultMode: process.env.DEFAULT_SCAN_MODE || 'fast',
        hasServerPat: Boolean(getServerPat()),
        authEnabled: Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD),
        platform: isVercel() ? 'vercel' : 'node',
        cronSchedule: '0 5 * * *',
        cronDescription: 'Daily at 8:00 AM Nairobi time (05:00 UTC)',
      });
    }

    const h = loadHandlers();

    if (route === 'status' && req.method === 'GET') {
      return json(res, 200, await h.getStatus());
    }

    if (route === 'latest' && req.method === 'GET') {
      return json(res, 200, await h.getLatestScan());
    }

    if (route === 'scan/latest' && req.method === 'GET') {
      return json(res, 200, await h.getLatestScan());
    }

    if (route === 'scan/history' && req.method === 'GET') {
      return json(res, 200, { files: h.listScanHistory() });
    }

    if (route === 'export-json' && req.method === 'GET') {
      const result = await h.getExportJson();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
      return json(res, 200, result.data);
    }

    if (route === 'export/json' && req.method === 'GET') {
      const result = await h.getExportJson();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
      return json(res, 200, result.data);
    }

    if (route === 'export-csv' && req.method === 'GET') {
      const result = await h.getExportCsv();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
      return res.status(200).send(result.csv);
    }

    if (route === 'export/csv' && req.method === 'GET') {
      const result = await h.getExportCsv();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
      return res.status(200).send(result.csv);
    }

    if ((route === 'report/teams') && req.method === 'GET') {
      const result = h.getTeamsReport();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(result.text);
    }

    if (route === 'scan' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const result = await h.runScan(body);
      if (result.error) return json(res, result.status || 500, { error: result.error });
      return json(res, 200, result);
    }

    if (route === 'cron/daily' && req.method === 'GET') {
      const result = await h.runDailyCron(req.headers);
      if (result.error) return json(res, result.status, { error: result.error });
      return json(res, 200, result);
    }

    if (route.startsWith('actions/') && req.method === 'POST') {
      const actionId = route.replace('actions/', '');
      const repo = (req.body || {}).repo;
      return json(res, 200, h.getActionGuidance(actionId, repo));
    }

    return json(res, 404, { error: `Unknown route: /api/${route}` });
  } catch (err) {
    console.error('API error:', route, err);
    return json(res, 500, { error: err.message || 'Internal server error' });
  }
};
