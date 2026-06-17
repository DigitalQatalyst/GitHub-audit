/**
 * Shared wrapper for all Vercel serverless API routes.
 */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function checkBasicAuth(req, res) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return true;

  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="GitHub Audit Dashboard"');
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [u, p] = decoded.split(':');
  if (u !== user || p !== pass) {
    res.status(401).json({ error: 'Invalid credentials' });
    return false;
  }
  return true;
}

function withApi(handler) {
  return async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!checkBasicAuth(req, res)) return;

    try {
      await handler(req, res);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  };
}

module.exports = { withApi, cors };
