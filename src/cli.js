#!/usr/bin/env node
/**
 * CLI runner for scheduled / headless audits.
 * Usage: GITHUB_PAT=xxx node src/cli.js [--account DigitalQatalyst] [--mode fast]
 */
require('dotenv').config();
const { runAudit } = require('./audit/scanner');
const { saveScan } = require('./audit/storage');
const { buildOrganisationSummary } = require('./audit/descriptions');

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    console.error('Error: GITHUB_PAT environment variable is required');
    process.exit(1);
  }

  const accountFilter = getArg('--account', process.env.AUDIT_ACCOUNT_FILTER || '');
  const mode = getArg('--mode', process.env.DEFAULT_SCAN_MODE || 'fast');
  const scope = getArg('--scope', 'all');
  const dataDir = process.env.DATA_DIR || './data';

  console.log(`Starting audit — account: ${accountFilter || 'all'}, mode: ${mode}`);

  const scan = await runAudit({
    pat,
    accountFilter,
    scope,
    mode,
    onProgress: ({ message, detail }) => console.log(`[${message}] ${detail || ''}`),
  });

  const orgSummary = buildOrganisationSummary(scan);
  scan.orgReport = orgSummary;

  const saved = saveScan(dataDir, scan);
  console.log(`\nAudit complete. ${scan.summary.visibleRepos} repos scanned.`);
  console.log(`Critical: ${scan.summary.critical} | Warning: ${scan.summary.warning} | Healthy: ${scan.summary.healthy}`);
  console.log(`Results saved to ${saved}`);
  console.log(`\n${orgSummary.overallAssessment}`);
}

main().catch((err) => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
