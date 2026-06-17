/**
 * Resolve GitHub PAT from environment (supports PAT or legacy GITHUB_PAT).
 */
function getServerPat() {
  return process.env.PAT || process.env.GITHUB_PAT || '';
}

module.exports = { getServerPat };
