const fs = require('fs');
const path = require('path');
const { loadScanFromGitHub, saveScanToGitHub } = require('./github-storage');

function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readLocalScan(dataDir) {
  const latestPath = path.join(dataDir, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
}

function writeLocalScan(dataDir, scan) {
  ensureDataDir(dataDir);
  const latestPath = path.join(dataDir, 'latest.json');
  const historyPath = path.join(
    dataDir,
    `scan-${scan.completedAt.replace(/[:.]/g, '-')}.json`,
  );
  const payload = JSON.stringify(scan, null, 2);
  fs.writeFileSync(latestPath, payload);
  fs.writeFileSync(historyPath, payload);
  return latestPath;
}

function pickNewerScan(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = new Date(a.completedAt || 0).getTime();
  const bTime = new Date(b.completedAt || 0).getTime();
  return bTime >= aTime ? b : a;
}

async function saveScan(dataDir, scan, options = {}) {
  const localPath = writeLocalScan(dataDir, scan);
  const pat = options.pat || '';

  if (pat) {
    try {
      await saveScanToGitHub(scan, pat);
    } catch (err) {
      console.error('GitHub scan persistence failed:', err.message);
    }
  }

  return localPath;
}

async function loadLatestScan(dataDir, options = {}) {
  const local = readLocalScan(dataDir);
  const pat = options.pat || '';
  const preferRemote = options.preferRemote ?? Boolean(process.env.VERCEL);

  if (!pat || !preferRemote) return local;

  try {
    const remote = await loadScanFromGitHub(pat);
    const latest = pickNewerScan(local, remote);
    if (latest && latest !== local) {
      writeLocalScan(dataDir, latest);
    }
    return latest;
  } catch (err) {
    console.warn('GitHub scan load failed:', err.message);
    return local;
  }
}

function listScanHistory(dataDir) {
  ensureDataDir(dataDir);
  return fs
    .readdirSync(dataDir)
    .filter((f) => f.startsWith('scan-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 30);
}

module.exports = { saveScan, loadLatestScan, listScanHistory, ensureDataDir };
