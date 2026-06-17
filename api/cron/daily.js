const { withApi } = require('../../src/vercel-helpers');
const { runDailyCron } = require('../../src/handlers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const result = await runDailyCron(req.headers);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(200).json(result);
});
