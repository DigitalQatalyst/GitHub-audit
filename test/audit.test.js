const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isCompliantBranchName,
  isVagueCommitMessage,
  computeHealthStatus,
  commitHygieneRating,
} = require('../src/audit/rules');
const { enrichRisk, buildOrganisationSummary } = require('../src/audit/descriptions');
const { partitionOrgRepos, matchesRepoScope } = require('../src/audit/scanner');
const { buildTeamsReport, postureLabel } = require('../src/audit/teamsReport');

describe('branch naming rules', () => {
  it('accepts approved lifecycle branches', () => {
    assert.equal(isCompliantBranchName('main'), true);
    assert.equal(isCompliantBranchName('develop'), true);
    assert.equal(isCompliantBranchName('staging'), true);
  });

  it('accepts feature/ and bugfix/ prefixes', () => {
    assert.equal(isCompliantBranchName('feature/user-login-john'), true);
    assert.equal(isCompliantBranchName('bugfix/payment-error-jane'), true);
  });

  it('rejects non-compliant prefixes', () => {
    assert.equal(isCompliantBranchName('fix/email-subscription'), false);
    assert.equal(isCompliantBranchName('feat/legal-pages'), false);
    assert.equal(isCompliantBranchName('TBD_feature/auth'), false);
    assert.equal(isCompliantBranchName('Feat/Landingpage'), false);
    assert.equal(isCompliantBranchName('cleanup/remove-logs'), false);
    assert.equal(isCompliantBranchName('origin/feature/test'), false);
  });
});

describe('commit hygiene', () => {
  it('flags vague messages', () => {
    assert.equal(isVagueCommitMessage('changes'), true);
    assert.equal(isVagueCommitMessage('first commit'), true);
    assert.equal(isVagueCommitMessage('test'), true);
  });

  it('accepts descriptive messages', () => {
    assert.equal(isVagueCommitMessage('feat: add user authentication flow'), false);
    assert.equal(isVagueCommitMessage('fix: resolve payment gateway timeout'), false);
  });

  it('rates hygiene levels', () => {
    assert.equal(commitHygieneRating(0).rating, 'Excellent');
    assert.equal(commitHygieneRating(50).rating, 'Poor');
  });
});

describe('health scoring', () => {
  it('marks high-risk repos as critical', () => {
    const status = computeHealthStatus({
      daysSincePush: 100,
      totalCommits: 0,
      vagueCommitPct: 60,
      nonCompliantBranches: 10,
      nonCompliantBranchPct: 70,
      openPrs: 5,
      stalledPrs: 5,
      prsWithoutReviewers: 3,
      commitsLast7d: 0,
      defaultBranchProtected: false,
      mergedPrsLast30d: 0,
    });
    assert.equal(status, 'critical');
  });
});

describe('repository discovery', () => {
  const sampleRepos = [
    { full_name: 'DigitalQatalyst/public-repo', owner: { login: 'DigitalQatalyst' }, archived: false, private: false },
    { full_name: 'DigitalQatalyst/private-repo', owner: { login: 'DigitalQatalyst' }, archived: false, private: true },
    { full_name: 'DigitalQatalyst/old-repo', owner: { login: 'DigitalQatalyst' }, archived: true, private: true },
    { full_name: 'OtherOrg/repo', owner: { login: 'OtherOrg' }, archived: false, private: false },
  ];

  it('includes public and private active org repos when scope is all', () => {
    const { active, archivedSkipped } = partitionOrgRepos(sampleRepos, 'DigitalQatalyst', 'all');
    assert.equal(active.length, 2);
    assert.equal(archivedSkipped, 1);
    assert.equal(active.some((r) => r.private), true);
  });

  it('filters to private repos only', () => {
    const { active } = partitionOrgRepos(sampleRepos, 'DigitalQatalyst', 'private');
    assert.equal(active.length, 1);
    assert.equal(active[0].full_name, 'DigitalQatalyst/private-repo');
  });

  it('matches repo visibility scope', () => {
    assert.equal(matchesRepoScope({ private: true }, 'private'), true);
    assert.equal(matchesRepoScope({ private: false }, 'private'), false);
    assert.equal(matchesRepoScope({ private: false }, 'public'), true);
  });
});

describe('teams report', () => {
  const sampleScan = {
    completedAt: '2026-06-18T12:00:00.000Z',
    accountFilter: 'DigitalQatalyst',
    summary: {
      visibleRepos: 4,
      totalDiscovered: 129,
      totalActive: 31,
      archivedSkipped: 98,
      publicRepos: 2,
      privateRepos: 2,
      critical: 2,
      warning: 1,
      healthy: 1,
      staleRepos: 1,
      openPrRisks: 3,
      namingViolations: 5,
      archivedSkipped: 2,
    },
    repositories: [
      {
        name: 'repo-a',
        health: 'critical',
        healthLabel: 'Critical',
        riskScore: 12,
        topIssue: 'Default protection missing',
        prWorkflow: { open: 2, stalled: 1 },
        risks: [
          { id: 'default-protection-missing', label: 'Default protection missing' },
          { id: 'stalled-prs', label: 'Stalled PRs (1)', count: 1 },
        ],
      },
      {
        name: 'repo-b',
        health: 'warning',
        healthLabel: 'Warning',
        riskScore: 6,
        prWorkflow: { open: 0, stalled: 0 },
        risks: [{ id: 'naming-violations', label: 'Naming violations (3)', count: 3 }],
      },
    ],
  };

  it('builds plain-text report for Teams', () => {
    const text = buildTeamsReport(sampleScan);
    assert.ok(text.includes('GitHub Governance Report'));
    assert.ok(text.includes('129 total repos'));
    assert.ok(text.includes('31 active'));
    assert.ok(text.includes('4 scanned'));
    assert.ok(text.includes('ANALYSIS'));
    assert.ok(text.includes('RECOMMENDED ACTIONS'));
    assert.ok(text.includes('repo-a'));
    assert.ok(!text.includes('|')); // no markdown tables
  });

  it('labels posture from summary', () => {
    assert.equal(postureLabel({ visibleRepos: 10, critical: 7, warning: 2 }), 'CRITICAL');
    assert.equal(postureLabel({ visibleRepos: 10, critical: 0, warning: 0, healthy: 10 }), 'ON TRACK');
  });
});

describe('descriptions', () => {
  it('enriches risk with plain language', () => {
    const risk = enrichRisk('stalled-prs', 3);
    assert.ok(risk.summary);
    assert.ok(risk.action);
    assert.equal(risk.label.includes('3'), true);
  });

  it('builds organisation summary', () => {
    const scan = {
      completedAt: '2026-06-17T00:00:00Z',
      accountFilter: 'TestOrg',
      summary: { visibleRepos: 10, critical: 7, warning: 2, healthy: 1, openPrRisks: 5, namingViolations: 20, staleRepos: 3 },
      repositories: [{ name: 'repo1', health: 'critical', risks: [{ label: 'test' }], topIssue: 'PRs stalled' }],
    };
    const report = buildOrganisationSummary(scan);
    assert.ok(report.overallAssessment.includes('CRITICAL'));
    assert.equal(report.topRepositories.length, 1);
  });
});
