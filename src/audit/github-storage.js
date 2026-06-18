/**
 * Persist scan results in a GitHub repo so Vercel cron data survives cold starts.
 */

const STORAGE_PATH = process.env.AUDIT_STORAGE_PATH || 'data/latest.json';
const STORAGE_REPO = process.env.AUDIT_STORAGE_REPO || 'DigitalQatalyst/GitHub-audit';

function parseRepo() {
  const [owner, repo] = STORAGE_REPO.split('/');
  if (!owner || !repo) throw new Error(`Invalid AUDIT_STORAGE_REPO: ${STORAGE_REPO}`);
  return { owner, repo };
}

async function getOctokit(pat) {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: pat, userAgent: 'github-audit-dashboard/1.0' });
}

async function loadScanFromGitHub(pat) {
  if (!pat) return null;
  const { owner, repo } = parseRepo();
  const octokit = await getOctokit(pat);

  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: STORAGE_PATH });
    if (Array.isArray(data) || !data.content) return null;
    const json = Buffer.from(data.content, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function saveScanToGitHub(scan, pat) {
  if (!pat) return false;
  const { owner, repo } = parseRepo();
  const octokit = await getOctokit(pat);

  let sha;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: STORAGE_PATH });
    if (!Array.isArray(data) && data.sha) sha = data.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const repos = scan.summary?.visibleRepos ?? scan.repositories?.length ?? 0;
  const content = Buffer.from(JSON.stringify(scan)).toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: STORAGE_PATH,
    message: `audit: daily scan ${scan.completedAt} (${repos} repos)`,
    content,
    sha,
  });

  return true;
}

module.exports = { loadScanFromGitHub, saveScanToGitHub, STORAGE_PATH, STORAGE_REPO };
