const { withApi } = require('../src/vercel-helpers');
const { runScan } = require('../src/handlers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const result = await runScan(req.body || {});
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.status(200).json(result);
});
