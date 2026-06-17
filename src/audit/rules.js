/**
 * Branch naming and commit hygiene rules aligned with DigitalQatalyst governance.
 */

const APPROVED_LIFECYCLE_BRANCHES = new Set([
  'main', 'master', 'develop', 'staging', 'release', 'prototype', 'sandbox',
]);

const APPROVED_PREFIXES = [
  'feature/',
  'bugfix/',
  'hotfix/',
  'prototype/',
  'sandbox/',
  'release/',
];

const DISALLOWED_PREFIXES = [
  'fix/', 'feat/', 'cleanup/', 'template/', 'merge/', 'landingpages/',
  'tbd_', 'tbd-', 'features/', 'hotfix/', 'feature-',
];

const VAGUE_COMMIT_PATTERNS = [
  /^changes?$/i,
  /^first commit$/i,
  /^cleanup$/i,
  /^test$/i,
  /^final$/i,
  /^update$/i,
  /^wip$/i,
  /^fix$/i,
  /^misc$/i,
  /^tmp$/i,
  /^asdf$/i,
  /^\.+$/,
  /^[a-z]$/i,
];

const PROTECTION_BRANCHES = ['main', 'master', 'develop', 'staging'];

/**
 * Check if a branch name follows org naming conventions.
 */
function isCompliantBranchName(name) {
  const lower = name.toLowerCase();

  if (APPROVED_LIFECYCLE_BRANCHES.has(lower)) return true;

  if (name.startsWith('origin/')) return false;
  if (name.includes('_') && !name.includes('/')) return false;
  if (/^[A-Z]/.test(name.split('/')[0])) return false;

  for (const prefix of DISALLOWED_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return false;
  }

  if (lower.startsWith('tbd')) return false;
  if (lower === 'dev' || lower === 'staging' || lower === 'release') {
    return APPROVED_LIFECYCLE_BRANCHES.has(lower);
  }

  for (const prefix of APPROVED_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const rest = name.slice(prefix.length);
      if (!rest || rest.length < 3) return false;
      return true;
    }
  }

  if (name.includes('/')) {
    const [prefix] = name.split('/');
    if (['Feature', 'Feat', 'Hotfix', 'Bugfix', 'Fix'].includes(prefix)) return false;
  }

  return false;
}

/**
 * Detect vague / non-descriptive commit messages.
 */
function isVagueCommitMessage(message) {
  const firstLine = (message || '').split('\n')[0].trim();
  if (!firstLine || firstLine.length < 4) return true;
  return VAGUE_COMMIT_PATTERNS.some((p) => p.test(firstLine));
}

/**
 * Compute health status from audit metrics.
 */
function computeHealthStatus(metrics) {
  let score = 0;

  if (metrics.daysSincePush > 90) score += 3;
  else if (metrics.daysSincePush > 30) score += 1;

  if (metrics.totalCommits === 0) score += 3;
  if (metrics.vagueCommitPct >= 50) score += 3;
  else if (metrics.vagueCommitPct >= 20) score += 1;

  if (metrics.nonCompliantBranchPct >= 50) score += 2;
  else if (metrics.nonCompliantBranches > 0) score += 1;

  if (metrics.openPrs > 0) {
    if (metrics.stalledPrs === metrics.openPrs) score += 2;
    if (metrics.prsWithoutReviewers > 0) score += 2;
  }

  if (metrics.commitsLast7d > 5 && metrics.openPrs === 0 && metrics.mergedPrsLast30d === 0) {
    score += 3;
  }

  if (!metrics.defaultBranchProtected) score += 2;

  if (score >= 5) return 'critical';
  if (score >= 2) return 'warning';
  return 'healthy';
}

/**
 * Human-readable health label.
 */
function healthLabel(status) {
  const labels = {
    critical: 'Critical',
    warning: 'Warning',
    healthy: 'Healthy',
  };
  return labels[status] || status;
}

/**
 * Human-readable commit hygiene rating.
 */
function commitHygieneRating(pct) {
  if (pct >= 40) return { rating: 'Poor', description: 'Many commits lack clear descriptions' };
  if (pct >= 15) return { rating: 'Fair', description: 'Some commits need better messages' };
  if (pct > 0) return { rating: 'Good', description: 'Mostly clear, a few vague messages' };
  return { rating: 'Excellent', description: 'All recent commits are descriptive' };
}

module.exports = {
  APPROVED_LIFECYCLE_BRANCHES,
  PROTECTION_BRANCHES,
  isCompliantBranchName,
  isVagueCommitMessage,
  computeHealthStatus,
  healthLabel,
  commitHygieneRating,
};
