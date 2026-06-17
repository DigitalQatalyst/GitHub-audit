const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isCompliantBranchName,
  isVagueCommitMessage,
  computeHealthStatus,
  commitHygieneRating,
} = require('../src/audit/rules');
const { enrichRisk, buildOrganisationSummary } = require('../src/audit/descriptions');

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
