const { withApi } = require('../../src/vercel-helpers');
const { getActionGuidance } = require('../../src/handlers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { actionId } = req.query;
  const { repo } = req.body || {};
  if (!actionId) return res.status(400).json({ error: 'actionId required' });
  res.status(200).json(getActionGuidance(actionId, repo));
});
