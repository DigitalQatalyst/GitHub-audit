/**
 * Plain-language descriptions for audit findings — written for non-developers.
 */

const RISK_DESCRIPTIONS = {
  'no-commits-24h': {
    label: 'No commits in 24h',
    summary: 'No code changes were pushed in the last day.',
    action: 'Confirm the team is actively working or the repo may be idle.',
  },
  'no-pr-activity-48h': {
    label: 'No PR activity 48h',
    summary: 'Open pull requests have had no review or update for over 2 days.',
    action: 'Assign reviewers and set a review deadline for stalled PRs.',
  },
  'default-protection-missing': {
    label: 'Default protection missing',
    summary: 'The main branch has no protection rules — anyone can push directly.',
    action: 'Enable branch protection requiring pull request reviews before merge.',
  },
  'naming-violations': {
    label: 'Naming violations',
    summary: 'Some branch names do not follow the organisation naming standard.',
    action: 'Rename branches to feature/description-developer or bugfix/description-developer format.',
  },
  'stalled-prs': {
    label: 'Stalled PRs',
    summary: 'Pull requests have been open for more than 24 hours without progress.',
    action: 'Review, merge, or close each open PR within 48 hours.',
  },
  'no-pr-reviewers': {
    label: 'PRs without reviewers',
    summary: 'Open pull requests have no one assigned to review the changes.',
    action: 'Assign at least one reviewer to every open pull request.',
  },
  'vague-commits': {
    label: 'Vague commit messages',
    summary: 'Recent commits use unclear messages like "changes" or "test".',
    action: 'Use descriptive messages such as "feat: add user login page".',
  },
  'inactive-90d': {
    label: 'Inactive 90+ days',
    summary: 'No code has been pushed to this repository in over 3 months.',
    action: 'Archive the repository or confirm it is still needed.',
  },
  'empty-repo': {
    label: 'Empty repository',
    summary: 'This repository has no commits or branches.',
    action: 'Delete if accidental, or initialise with a README and first commit.',
  },
  'no-pr-workflow': {
    label: 'No PR workflow',
    summary: 'Code is being committed directly to branches without pull request review.',
    action: 'Require all changes to go through a reviewed pull request.',
  },
  'missing-contributing': {
    label: 'Missing CONTRIBUTING',
    summary: 'No CONTRIBUTING guide exists to help contributors follow team standards.',
    action: 'Add a CONTRIBUTING.md file with branch naming and PR guidelines.',
  },
  'high-velocity-no-governance': {
    label: 'High activity, no governance',
    summary: 'This repo has frequent commits but no pull request review process.',
    action: 'Urgently enable branch protection and PR-only workflow.',
  },
};

function describeProtection(branch, status) {
  const map = {
    protected: `${branch}: protected`,
    missing: `${branch}: missing protection`,
    'missing-branch': `${branch}: missing branch`,
    unknown: `${branch}: unknown`,
  };
  return map[status] || `${branch}:${status}`;
}

function buildRepoSummary(repo) {
  const lines = [];
  const h = repo.health;

  if (h === 'critical') {
    lines.push(`This repository needs immediate attention. ${repo.riskCount} governance issue(s) were found.`);
  } else if (h === 'warning') {
    lines.push(`This repository has minor governance gaps that should be addressed soon.`);
  } else {
    lines.push(`This repository follows most governance standards.`);
  }

  if (repo.activity?.daysSincePush != null) {
    if (repo.activity.daysSincePush === 0) {
      lines.push('Last activity: today.');
    } else if (repo.activity.daysSincePush === 1) {
      lines.push('Last activity: yesterday.');
    } else {
      lines.push(`Last activity: ${repo.activity.daysSincePush} days ago.`);
    }
  }

  return lines.join(' ');
}

function buildOrganisationSummary(scan) {
  const { summary } = scan;
  const total = summary.visibleRepos || 0;
  const critical = summary.critical || 0;
  const criticalPct = total ? Math.round((critical / total) * 100) : 0;

  let assessment;
  if (criticalPct >= 60) {
    assessment = `CRITICAL — ${criticalPct}% of repositories (${critical} of ${total}) need immediate remediation.`;
  } else if (criticalPct >= 30) {
    assessment = `WARNING — ${criticalPct}% of repositories (${critical} of ${total}) have significant governance gaps.`;
  } else {
    assessment = `MODERATE — ${critical} of ${total} repositories need attention.`;
  }

  const findings = [];

  if (summary.openPrRisks > 0) {
    findings.push({
      finding: 'Open PR risks',
      count: summary.openPrRisks,
      severity: 'Critical',
      description: 'Pull requests are stalled or lack assigned reviewers.',
    });
  }

  if (summary.namingViolations > 0) {
    findings.push({
      finding: 'Non-compliant branch names',
      count: summary.namingViolations,
      severity: 'Critical',
      description: 'Branches do not follow the feature/ and bugfix/ naming standard.',
    });
  }

  if (summary.staleRepos > 0) {
    findings.push({
      finding: 'Inactive repositories',
      count: summary.staleRepos,
      severity: 'Warning',
      description: 'Repositories with no activity in 90+ days may be abandoned.',
    });
  }

  const criticalRepos = (scan.repositories || [])
    .filter((r) => r.health === 'critical')
    .slice(0, 10)
    .map((r, i) => ({
      rank: i + 1,
      repository: r.name,
      status: 'CRITICAL',
      keyIssue: r.topIssue || r.risks?.[0]?.label || 'Multiple governance issues',
    }));

  return {
    overallAssessment: assessment,
    keyFindings: findings,
    topRepositories: criticalRepos,
    scannedAt: scan.completedAt,
    accountFilter: scan.accountFilter,
  };
}

function enrichRisk(riskId, count) {
  const base = RISK_DESCRIPTIONS[riskId];
  if (!base) return { id: riskId, label: riskId, count };
  return {
    id: riskId,
    ...base,
    count: count > 1 ? count : undefined,
    label: count > 1 ? `${base.label} (${count})` : base.label,
  };
}

module.exports = {
  RISK_DESCRIPTIONS,
  describeProtection,
  buildRepoSummary,
  buildOrganisationSummary,
  enrichRisk,
};
