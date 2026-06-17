const fs = require('fs');
const path = require('path');

function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function saveScan(dataDir, scan) {
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

function loadLatestScan(dataDir) {
  const latestPath = path.join(dataDir, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
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
