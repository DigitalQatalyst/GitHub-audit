const { withApi } = require('../../src/vercel-helpers');
const { getLatestScan } = require('../../src/handlers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.status(200).json(getLatestScan());
});
