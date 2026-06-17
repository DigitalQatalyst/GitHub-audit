const path = require('path');

/**
 * Resolve GitHub PAT from environment (supports PAT or legacy GITHUB_PAT).
 */
function getServerPat() {
  return process.env.PAT || process.env.GITHUB_PAT || '';
}

/**
 * Data directory — uses /tmp on Vercel (ephemeral but works per instance).
 */
function getDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.env.VERCEL) return '/tmp/github-audit-data';
  return path.resolve('./data');
}

function isVercel() {
  return Boolean(process.env.VERCEL);
}

module.exports = { getServerPat, getDataDir, isVercel };
