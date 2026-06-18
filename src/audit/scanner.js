const {
  isCompliantBranchName,
  isVagueCommitMessage,
  computeHealthStatus,
  healthLabel,
  commitHygieneRating,
  PROTECTION_BRANCHES,
} = require('./rules');
const { describeProtection, buildRepoSummary, enrichRisk } = require('./descriptions');

const MS_DAY = 24 * 60 * 60 * 1000;

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / MS_DAY);
}

function formatActivityDate(dateStr) {
  const d = daysSince(dateStr);
  if (d === null) return '—';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a full organisation audit against GitHub API.
 */
async function runAudit(options) {
  const {
    pat,
    accountFilter = '',
    scope = 'all',
    mode = 'fast',
    onProgress,
  } = options;

  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: pat, userAgent: 'github-audit-dashboard/1.0' });

  const progress = (msg, detail) => {
    if (onProgress) onProgress({ message: msg, detail });
  };

  progress('Authenticating', 'Verifying PAT');
  const { data: viewer } = await octokit.users.getAuthenticated();
  progress('Authenticated', viewer.login);

  const repos = await fetchAllRepositories(octokit, accountFilter, scope, progress);
  const archivedSkipped = repos.archivedSkipped || 0;
  const totalDiscovered = repos.totalDiscovered || 0;
  const repoList = repos.list;
  progress('Found repositories', `${repoList.length} active repos to scan`);

  let namingViolations = 0;
  let openPrRisks = 0;
  let protectionUnknown = 0;

  const repositories = await mapWithConcurrency(repoList, 4, async (repo, index) => {
    const [owner, name] = [repo.owner.login, repo.name];
    progress('Scanning', `${owner}/${name} (${index + 1}/${repoList.length})`);

    if (index > 0 && index % 8 === 0) {
      const rateCheck = await octokit.rateLimit.get();
      if (rateCheck.data.resources.core.remaining < 80) {
        progress('Rate limit pause', 'Waiting for API quota');
        await sleep(45000);
      }
    }

    return auditRepository(octokit, owner, name, repo, mode);
  });

  for (const repoAudit of repositories) {
    namingViolations += repoAudit.branches?.nonCompliant || 0;
    openPrRisks += repoAudit.prWorkflow?.atRisk || 0;
    if (repoAudit.protection?.unknown) protectionUnknown += repoAudit.protection.unknown;
  }

  repositories.sort((a, b) => {
    const order = { critical: 0, warning: 1, healthy: 2 };
    return (order[a.health] ?? 3) - (order[b.health] ?? 3) || b.riskScore - a.riskScore;
  });

  const critical = repositories.filter((r) => r.health === 'critical').length;
  const warning = repositories.filter((r) => r.health === 'warning').length;
  const healthy = repositories.filter((r) => r.health === 'healthy').length;
  const staleRepos = repositories.filter((r) => (r.activity?.daysSincePush ?? 0) > 90).length;

  const ownerCounts = {};
  for (const r of repositories) {
    const o = r.fullName.split('/')[0];
    ownerCounts[o] = (ownerCounts[o] || 0) + 1;
  }

  const finalRate = await octokit.rateLimit.get();

  return {
    status: 'complete',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    accountFilter: accountFilter || 'all accessible',
    scope,
    mode,
    viewer: viewer.login,
    rateLimitRemaining: finalRate.data.resources.core.remaining,
    summary: {
      visibleRepos: repositories.length,
      totalDiscovered,
      archivedSkipped,
      critical,
      warning,
      healthy,
      staleRepos,
      openPrRisks,
      namingViolations,
      protectionUnknown,
      archivedSkipped,
    },
    owners: Object.entries(ownerCounts).map(([name, count]) => ({ name, count })),
    repositories,
  };
}

async function auditRepository(octokit, owner, name, repoMeta, mode) {
  const fullName = `${owner}/${name}`;
  const defaultBranch = repoMeta.default_branch || 'main';

  let branches = [];
  let commits = [];
  let pullRequests = [];
  let hasReadme = false;
  let hasContributing = false;

  try {
    if (mode === 'thorough') {
      branches = await octokit.paginate(octokit.repos.listBranches, {
        owner, repo: name, per_page: 100,
      });
    } else {
      const { data: branchPage } = await octokit.repos.listBranches({
        owner, repo: name, per_page: 100,
      });
      branches = branchPage;
    }
  } catch { /* empty or no access */ }

  const commitLimit = mode === 'thorough' ? 100 : 30;
  try {
    const { data: commitList } = await octokit.repos.listCommits({
      owner, repo: name, per_page: commitLimit,
    });
    commits = commitList;
  } catch { /* empty */ }

  try {
    pullRequests = await octokit.paginate(octokit.pulls.list, {
      owner, repo: name, state: 'open', per_page: 100,
    });
  } catch { /* none */ }

  try {
    await octokit.repos.getContent({ owner, repo: name, path: 'README.md' });
    hasReadme = true;
  } catch { /* missing */ }

  try {
    await octokit.repos.getContent({ owner, repo: name, path: 'CONTRIBUTING.md' });
    hasContributing = true;
  } catch { /* missing */ }

  const nonCompliantBranches = branches
    .map((b) => b.name)
    .filter((n) => !isCompliantBranchName(n));

  const vagueCommits = commits.filter((c) => isVagueCommitMessage(c.commit?.message));
  const vaguePct = commits.length ? Math.round((vagueCommits.length / commits.length) * 1000) / 10 : 0;
  const hygiene = commitHygieneRating(vaguePct);

  const now = Date.now();
  const commits24h = commits.filter((c) => now - new Date(c.commit.author.date).getTime() < MS_DAY).length;
  const commits7d = commits.filter((c) => now - new Date(c.commit.author.date).getTime() < 7 * MS_DAY).length;

  const lastPush = repoMeta.pushed_at;
  const daysIdle = daysSince(lastPush);
  const lastCommitter = commits[0]?.commit?.author?.name || commits[0]?.author?.login || '—';

  const stalledPrs = pullRequests.filter((pr) => {
    const lastActivity = new Date(pr.updated_at || pr.created_at).getTime();
    const idleH = (Date.now() - lastActivity) / (1000 * 60 * 60);
    return idleH > 24;
  });

  const prsNoReviewers = pullRequests.filter((pr) => !hasAssignedReviewers(pr));

  const atRiskPrs = pullRequests.filter((pr) => {
    const lastActivity = new Date(pr.updated_at || pr.created_at).getTime();
    const idleH = (Date.now() - lastActivity) / (1000 * 60 * 60);
    return idleH > 24 || !hasAssignedReviewers(pr);
  });

  const protection = await checkProtection(octokit, owner, name, branches);

  const defaultProtected = protection.branches[defaultBranch] === 'protected';

  const totalCommits = commits.length;
  const branchCount = branches.length;
  const nonCompliantCount = nonCompliantBranches.length;

  const metrics = {
    daysSincePush: daysIdle ?? 999,
    totalCommits,
    vagueCommitPct: vaguePct,
    nonCompliantBranches: nonCompliantCount,
    nonCompliantBranchPct: branchCount ? (nonCompliantCount / branchCount) * 100 : 0,
    openPrs: pullRequests.length,
    stalledPrs: stalledPrs.length,
    prsWithoutReviewers: prsNoReviewers.length,
    commitsLast7d: commits7d,
    defaultBranchProtected: defaultProtected,
    mergedPrsLast30d: 0,
  };

  const health = computeHealthStatus(metrics);
  const risks = buildRisks(metrics, nonCompliantCount, hasContributing, commits24h, health);

  const riskScore = risks.length + (health === 'critical' ? 10 : health === 'warning' ? 5 : 0);

  const branchSummary = buildBranchSummary(branchCount, nonCompliantBranches, branches, mode);
  const protectionSummary = PROTECTION_BRANCHES
    .map((b) => describeProtection(b, protection.branches[b] || 'missing-branch'))
    .join(' | ');

  const actions = buildActions(risks, protection, hasContributing);

  return {
    fullName,
    name,
    owner,
    url: repoMeta.html_url || `https://github.com/${owner}/${name}`,
    visibility: repoMeta.private ? 'private' : 'public',
    defaultBranch,
    health,
    healthLabel: healthLabel(health),
    summary: buildRepoSummary({ health, riskCount: risks.length, activity: { daysSincePush: daysIdle } }),
    topIssue: risks[0]?.summary || null,
    riskScore,
    activity: {
      lastPush: formatActivityDate(lastPush),
      daysSincePush: daysIdle,
      lastCommitter,
      commits24h,
      commits7d,
      display: `${formatActivityDate(lastPush)} · ${lastCommitter} · 24h: ${commits24h} · 7d: ${commits7d}`,
    },
    commitHygiene: {
      vaguePct,
      rating: hygiene.rating,
      description: hygiene.description,
      display: `${hygiene.rating} ${vaguePct}%`,
      samples: vagueCommits.slice(0, 3).map((c) => c.commit.message.split('\n')[0]),
    },
    branches: branchSummary,
    prWorkflow: {
      open: pullRequests.length,
      atRisk: atRiskPrs.length,
      stalled: stalledPrs.length,
      noReviewers: prsNoReviewers.length,
      forceMerged: 0,
      display: buildPrDisplay(pullRequests.length, stalledPrs.length, prsNoReviewers.length),
      details: mode === 'thorough' ? pullRequests.slice(0, 5).map((pr) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login,
        ageHours: Math.round((Date.now() - new Date(pr.created_at)) / (1000 * 60 * 60)),
        reviewers: pr.requested_reviewers?.length || 0,
      })) : undefined,
    },
    protection: {
      summary: protectionSummary,
      branches: protection.branches,
      unknown: protection.unknown,
    },
    docs: {
      readme: hasReadme,
      contributing: hasContributing,
      display: `README ${hasReadme ? 'Yes' : 'No'}`,
    },
    risks,
    riskCount: risks.length,
    actions,
  };
}

function hasAssignedReviewers(pr) {
  const reviewers = pr.requested_reviewers?.length || 0;
  const teams = pr.requested_teams?.length || 0;
  const assignees = pr.assignees?.length || 0;
  return reviewers + teams + assignees > 0;
}

/**
 * Fetch all non-archived org repositories. Tries multiple GitHub APIs because
 * listForOrg returns 404 when the PAT lacks read:org or org SSO authorization.
 */
async function fetchAllRepositories(octokit, accountFilter, scope, progress) {
  const repoMap = new Map();
  const filter = (accountFilter || process.env.AUDIT_ACCOUNT_FILTER || '').trim();

  if (filter) {
    const strategies = [
      { name: 'organisation list', fn: () => fetchViaOrgList(octokit, filter, scope, progress) },
      { name: 'repository search', fn: () => fetchViaSearch(octokit, filter, scope, progress) },
      { name: 'member repositories', fn: () => fetchViaMemberRepos(octokit, filter, scope, progress) },
    ];

    let lastError = null;
    for (const { name, fn } of strategies) {
      try {
        const result = await fn();
        if (result.list.length > 0) {
          progress('Org inventory', `${result.list.length} active repos via ${name}`);
          return result;
        }
        progress('Fetch note', `${name} returned no repos, trying next method`);
      } catch (err) {
        lastError = err;
        progress('Fetch fallback', `${name} unavailable (${err.status || 'error'}): trying next method`);
      }
    }

    throw formatOrgAccessError(filter, lastError);
  }

  progress('Fetching repositories', 'All accessible via PAT');
  const allAccessible = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    per_page: 100,
    affiliation: 'owner,collaborator,organization_member',
    sort: 'updated',
  });
  for (const r of allAccessible) {
    if (!r.archived) repoMap.set(r.full_name, r);
  }

  const list = [...repoMap.values()];
  return { list, archivedSkipped: 0, totalDiscovered: list.length };
}

function formatOrgAccessError(filter, err) {
  const detail = err?.message || 'unknown error';
  return new Error(
    `Cannot list ${filter} repositories. Your PAT needs repo and read:org scopes, ` +
    `access to the organisation (fine-grained tokens: grant org + repository access), ` +
    `and SSO authorization if the org uses it. Original error: ${detail}`,
  );
}

function collectOrgRepos(repos, filter, scope) {
  const repoMap = new Map();
  let archivedSkipped = 0;

  for (const r of repos) {
    if (r.owner?.login?.toLowerCase() !== filter.toLowerCase()) continue;
    if (r.archived) {
      archivedSkipped += 1;
      continue;
    }
    if (scope === 'private' && !r.private) continue;
    if (scope === 'public' && r.private) continue;
    repoMap.set(r.full_name, r);
  }

  const list = [...repoMap.values()];
  return { list, archivedSkipped, totalDiscovered: list.length + archivedSkipped };
}

async function fetchViaOrgList(octokit, filter, scope, progress) {
  progress('Fetching repositories', `Listing ${filter} via organisation API`);
  const orgRepos = await octokit.paginate(octokit.repos.listForOrg, {
    org: filter,
    per_page: 100,
    type: scope === 'public' ? 'public' : 'all',
    sort: 'updated',
  });
  return collectOrgRepos(orgRepos, filter, scope);
}

async function fetchViaSearch(octokit, filter, scope, progress) {
  let q = `org:${filter} archived:false`;
  if (scope === 'private') q += ' is:private';
  else if (scope === 'public') q += ' is:public';

  progress('Fetching repositories', `Searching: ${q}`);
  const repoMap = new Map();
  let page = 1;
  let totalCount = 0;

  while (true) {
    const { data } = await octokit.search.repos({ q, per_page: 100, page });
    totalCount = data.total_count;
    for (const r of data.items) {
      if (r.owner?.login?.toLowerCase() === filter.toLowerCase()) {
        repoMap.set(r.full_name, r);
      }
    }
    if (repoMap.size >= totalCount || data.items.length < 100) break;
    page += 1;
  }

  const list = [...repoMap.values()];
  return {
    list,
    archivedSkipped: 0,
    totalDiscovered: list.length,
  };
}

async function fetchViaMemberRepos(octokit, filter, scope, progress) {
  progress('Fetching repositories', `Listing repos visible to token for ${filter}`);
  const memberRepos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    per_page: 100,
    affiliation: 'organization_member,owner,collaborator',
    sort: 'updated',
  });
  return collectOrgRepos(memberRepos, filter, scope);
}

function buildRisks(metrics, nonCompliantCount, hasContributing, commits24h, health) {
  const risks = [];

  if (commits24h === 0 && metrics.totalCommits > 0 && (metrics.daysSincePush ?? 999) < 90) {
    risks.push(enrichRisk('no-commits-24h'));
  }

  if (metrics.openPrs > 0 && metrics.stalledPrs === metrics.openPrs) {
    risks.push(enrichRisk('no-pr-activity-48h'));
  }

  if (!metrics.defaultBranchProtected) {
    risks.push(enrichRisk('default-protection-missing'));
  }

  if (nonCompliantCount > 0) {
    risks.push(enrichRisk('naming-violations', nonCompliantCount));
  }

  if (metrics.stalledPrs > 0) {
    risks.push(enrichRisk('stalled-prs', metrics.stalledPrs));
  }

  if (metrics.prsWithoutReviewers > 0) {
    risks.push(enrichRisk('no-pr-reviewers', metrics.prsWithoutReviewers));
  }

  if (metrics.vagueCommitPct >= 15) {
    risks.push(enrichRisk('vague-commits'));
  }

  if (metrics.daysSincePush > 90) {
    risks.push(enrichRisk('inactive-90d'));
  }

  if (metrics.totalCommits === 0) {
    risks.push(enrichRisk('empty-repo'));
  }

  if (metrics.commitsLast7d > 5 && metrics.openPrs === 0) {
    risks.push(enrichRisk('no-pr-workflow'));
  }

  if (metrics.commitsLast7d > 10 && metrics.openPrs === 0 && !metrics.defaultBranchProtected) {
    risks.push(enrichRisk('high-velocity-no-governance'));
  }

  if (!hasContributing && (health === 'critical' || risks.length >= 2)) {
    risks.push(enrichRisk('missing-contributing'));
  }

  return risks;
}

function buildBranchSummary(total, nonCompliant, allBranches, mode) {
  const stale = allBranches.filter((b) => {
    const date = b.commit?.commit?.author?.date;
    return date && daysSince(date) > 30;
  }).length;

  const parts = [`${total} total`];
  if (stale > 0) parts.push(`${stale} stale`);
  if (nonCompliant.length > 0) parts.push(`${nonCompliant.length} nonstd`);

  return {
    total,
    stale,
    nonCompliant: nonCompliant.length,
    samples: nonCompliant.slice(0, 8),
    display: parts.join(' · '),
  };
}

function buildPrDisplay(open, stalled, noReviewers) {
  if (open === 0) return 'None open';
  const parts = [`${open} open`];
  if (stalled > 0) parts.push(`${stalled} stalled`);
  if (noReviewers > 0) parts.push(`${noReviewers} no reviewer`);
  return parts.join(' · ');
}

async function checkProtection(octokit, owner, name, branches) {
  const branchNames = new Set(branches.map((b) => b.name));
  const result = { branches: {}, unknown: 0 };

  await Promise.all(PROTECTION_BRANCHES.map(async (branch) => {
    if (!branchNames.has(branch)) {
      result.branches[branch] = 'missing-branch';
      return;
    }
    try {
      await octokit.repos.getBranchProtection({ owner, repo: name, branch });
      result.branches[branch] = 'protected';
    } catch (err) {
      if (err.status === 404) {
        result.branches[branch] = 'missing';
      } else {
        result.branches[branch] = 'unknown';
        result.unknown += 1;
      }
    }
  }));

  return result;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function buildActions(risks, protection, hasContributing) {
  const actions = [];
  const riskIds = new Set(risks.map((r) => r.id));

  if (riskIds.has('default-protection-missing') || Object.values(protection.branches).includes('missing')) {
    actions.push({ id: 'enforce-protection', label: 'Verify/enforce protection', type: 'remediation' });
  }

  if (riskIds.has('missing-contributing') || !hasContributing) {
    actions.push({ id: 'add-contributing', label: 'Add CONTRIBUTING', type: 'remediation' });
  }

  if (riskIds.has('naming-violations')) {
    actions.push({ id: 'fix-branch-names', label: 'Fix branch names', type: 'remediation' });
  }

  if (riskIds.has('stalled-prs') || riskIds.has('no-pr-reviewers')) {
    actions.push({ id: 'triage-prs', label: 'Triage open PRs', type: 'remediation' });
  }

  return actions;
}

module.exports = { runAudit, daysSince };
