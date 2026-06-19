/**
 * Teams-ready governance report — plain text for copy-paste into Microsoft Teams.
 */

const RISK_THEMES = {
  'default-protection-missing': 'Branch protection gaps',
  'no-pr-workflow': 'No PR workflow',
  'high-velocity-no-governance': 'High activity without governance',
  'stalled-prs': 'Stalled pull requests',
  'no-pr-reviewers': 'PRs without reviewers',
  'no-pr-activity-48h': 'Stale PR activity',
  'naming-violations': 'Non-standard branch names',
  'vague-commits': 'Unclear commit messages',
  'inactive-90d': 'Inactive repositories (90+ days)',
  'empty-repo': 'Empty repositories',
  'missing-contributing': 'Missing CONTRIBUTING guide',
  'no-commits-24h': 'No recent commits (24h)',
};

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function formatDate(iso) {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function postureLabel(summary) {
  const total = summary.visibleRepos || 0;
  const critical = summary.critical || 0;
  const criticalPct = pct(critical, total);
  if (criticalPct >= 60) return 'CRITICAL';
  if (criticalPct >= 30) return 'AT RISK';
  if (critical > 0 || (summary.warning || 0) > 0) return 'NEEDS ATTENTION';
  return 'ON TRACK';
}

function aggregateThemes(repositories) {
  const themes = new Map();
  for (const repo of repositories) {
    for (const risk of repo.risks || []) {
      const label = RISK_THEMES[risk.id] || risk.label;
      const entry = themes.get(label) || { label, repoCount: 0, detail: 0 };
      entry.repoCount += 1;
      if (typeof risk.count === 'number') entry.detail += risk.count;
      themes.set(label, entry);
    }
  }
  return [...themes.values()].sort((a, b) => b.repoCount - a.repoCount);
}

function buildAnalysis(summary, themes) {
  const parts = [];
  if ((summary.critical || 0) > 0) {
    parts.push(`${summary.critical} repo(s) need immediate remediation`);
  }
  if ((summary.openPrRisks || 0) > 0) {
    parts.push('pull request review discipline is weak');
  }
  const protectionTheme = themes.find((t) => t.label === 'Branch protection gaps');
  if (protectionTheme) {
    parts.push('default branches lack adequate protection');
  }
  if ((summary.namingViolations || 0) > 0) {
    parts.push('branch naming standards are not consistently followed');
  }
  if (parts.length === 0) {
    return 'Governance standards are broadly met across scanned repositories.';
  }
  return `Primary concerns: ${parts.join('; ')}.`;
}

function buildActions(repositories, summary) {
  const lines = [];
  const unprotected = repositories.filter((r) =>
    (r.risks || []).some((x) => x.id === 'default-protection-missing'),
  ).length;
  const stalledPrs = repositories.reduce((n, r) => n + (r.prWorkflow?.stalled || 0), 0);

  if (summary.critical > 0) {
    lines.push(`This week — Assign owners and remediation plans for ${summary.critical} critical repo(s). (Engineering leads)`);
  }
  if (unprotected > 0) {
    lines.push(`This week — Enable branch protection on default branches across ${unprotected} repo(s). (DevOps / repo admins)`);
  }
  if (stalledPrs > 0) {
    lines.push(`Next 7 days — Triage ${stalledPrs} stalled PR(s): assign reviewers, merge, or close. (Delivery managers)`);
  }
  if ((summary.namingViolations || 0) > 0) {
    lines.push('Next 14 days — Run branch naming cleanup to align with feature/ and bugfix/ standards. (Tech leads)');
  }
  if ((summary.staleRepos || 0) > 0) {
    lines.push(`Next 30 days — Review ${summary.staleRepos} inactive repo(s): archive or confirm still needed. (Product owners)`);
  }
  if (lines.length === 0) {
    lines.push('Ongoing — Maintain standards and continue weekly governance reviews. (Engineering leads)');
  }
  return lines;
}

function priorityRepos(repositories) {
  return repositories
    .filter((r) => r.health === 'critical' || r.health === 'warning')
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, healthy: 2 };
      return (order[a.health] ?? 3) - (order[b.health] ?? 3) || b.riskScore - a.riskScore;
    })
    .slice(0, 10);
}

/**
 * Build a plain-text analytical report for Microsoft Teams.
 */
function buildTeamsReport(scan) {
  if (!scan?.summary) {
    return 'No scan data available. Run an audit first, then copy this report to Teams.';
  }

  const { summary, accountFilter } = scan;
  const repositories = scan.repositories || [];
  const themes = aggregateThemes(repositories);
  const posture = postureLabel(summary);
  const total = summary.totalDiscovered || summary.visibleRepos || 0;
  const active = summary.totalActive || summary.visibleRepos || 0;
  const scanned = summary.visibleRepos || 0;
  const archived = summary.archivedSkipped || 0;
  const healthyPct = pct(summary.healthy || 0, scanned);

  const lines = [
    `GitHub Governance Report — ${accountFilter || 'Account'}`,
    formatDate(scan.completedAt),
    '',
    `OVERALL POSTURE: ${posture}`,
    `${total} total repos · ${active} active · ${scanned} scanned · ${archived} archived excluded.`,
    `Health split (scanned): ${summary.healthy || 0} healthy (${healthyPct}%) · ${summary.warning || 0} warning · ${summary.critical || 0} critical`,
    '',
    'ANALYSIS',
    buildAnalysis(summary, themes),
    '',
    'KEY FINDINGS',
  ];

  if (themes.length === 0) {
    lines.push('• No material governance issues detected.');
  } else {
    for (const theme of themes.slice(0, 6)) {
      const extra = theme.detail > theme.repoCount ? ` (${theme.detail} instances)` : '';
      lines.push(`• ${theme.label} — ${theme.repoCount} repo(s)${extra}`);
    }
    if ((summary.staleRepos || 0) > 0 && !themes.some((t) => t.label.includes('Inactive'))) {
      lines.push(`• Inactive repositories — ${summary.staleRepos} repo(s) with no activity in 90+ days`);
    }
  }

  lines.push('', 'RECOMMENDED ACTIONS');
  for (const action of buildActions(repositories, summary)) {
    lines.push(`→ ${action}`);
  }

  const priority = priorityRepos(repositories);
  if (priority.length > 0) {
    lines.push('', 'REPOS REQUIRING ATTENTION');
    priority.forEach((r, i) => {
      const issue = r.topIssue || r.risks?.[0]?.label || 'Multiple governance gaps';
      const prs = r.prWorkflow?.open ? ` · ${r.prWorkflow.open} open PR(s)` : '';
      lines.push(`${i + 1}. ${r.name} — ${r.healthLabel.toUpperCase()} — ${issue}${prs}`);
    });
  }

  lines.push(
    '',
    '---',
    summary.accessNote
      ? summary.accessNote
      : 'Source: GitHub Governance Dashboard · Audit covers active non-archived repos only.',
  );

  return lines.join('\n');
}

module.exports = { buildTeamsReport, postureLabel, aggregateThemes };
