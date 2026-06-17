const { withApi } = require('../../src/vercel-helpers');
const { getExportCsv } = require('../../src/handlers');

module.exports = withApi(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const result = getExportCsv();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit-results.csv');
  res.status(200).send(result.csv);
});
