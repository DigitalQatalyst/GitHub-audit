const { withApi } = require('../../src/vercel-helpers');
const { getExportJson } = require('../../src/handlers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const result = getExportJson();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.json');
  res.status(200).json(result.data);
});
