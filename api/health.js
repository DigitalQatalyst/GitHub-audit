const { getServerPat, isVercel } = require('../src/config');
const { withApi } = require('../src/vercel-helpers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.status(200).json({ ok: true, hasPat: Boolean(getServerPat()), platform: isVercel() ? 'vercel' : 'node' });
});
