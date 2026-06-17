/**
 * Single Vercel serverless handler for ALL /api/* routes.
 * One file avoids bundle crashes from duplicated heavy imports.
 */
require('dotenv').config();

const { getServerPat, getDataDir, isVercel } = require('../src/config');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, data) {
  res.status(status).json(data);
}

function getRoute(req) {
  // Primary: parse from URL (most reliable on Vercel)
  const url = (req.url || '').split('?')[0];
  if (url.startsWith('/api/')) return url.slice(5).replace(/\/$/, '');
  if (url === '/api') return '';

  // Fallback: catch-all query param
  const segments = req.query.path;
  if (segments) {
    return Array.isArray(segments) ? segments.join('/') : String(segments);
  }
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
    // ── Lightweight routes (no heavy imports) ──
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
      });
    }

    // ── Routes that need handlers (lazy-loaded) ──
    const h = loadHandlers();

    if (route === 'status' && req.method === 'GET') {
      return json(res, 200, h.getStatus());
    }

    if (route === 'scan/latest' && req.method === 'GET') {
      return json(res, 200, h.getLatestScan());
    }

    if (route === 'scan/history' && req.method === 'GET') {
      return json(res, 200, { files: h.listScanHistory() });
    }

    if (route === 'export/json' && req.method === 'GET') {
      const result = h.getExportJson();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
      return json(res, 200, result.data);
    }

    if (route === 'export/csv' && req.method === 'GET') {
      const result = h.getExportCsv();
      if (result.error) return json(res, result.status, { error: result.error });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
      return res.status(200).send(result.csv);
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
