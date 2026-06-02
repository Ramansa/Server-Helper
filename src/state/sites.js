const fsp = require('fs/promises');
const path = require('path');
const { config } = require('../config/paths');
const { createMutex } = require('../utils/mutex');

const sites = [];
let nextSiteId = 0;
const withSitesLock = createMutex();

async function loadSites() {
  try {
    const data = await fsp.readFile(config.databasePath, 'utf8');
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        sites.splice(0, sites.length, ...parsed);
      }
    } catch {
      sites.splice(0, sites.length);
    }
    updateNextSiteId();
  } catch (error) {
    if (error.code === 'ENOENT') {
      sites.splice(0, sites.length, {
        id: '1',
        domain: 'api.example.com',
        type: 'proxy',
        port: 80,
        phpVersion: 'none',
        target: 'http://localhost:3000',
        ssl: false,
        enabled: true,
        acmeStatus: 'none',
        customConfig: '',
      });
      nextSiteId = 1;
      await saveSites();
      return;
    }
    throw error;
  }
}

async function saveSites() {
  const data = JSON.stringify(sites, null, 2);
  await fsp.writeFile(config.databasePath, data);
}

function updateNextSiteId() {
  let maxId = 0;
  for (const site of sites) {
    const parsed = Number.parseInt(site.id, 10);
    if (!Number.isNaN(parsed) && parsed > maxId) {
      maxId = parsed;
    }
  }
  nextSiteId = maxId;
}

function genId() {
  nextSiteId += 1;
  return String(nextSiteId);
}

async function getSiteRoot(site) {
  const domain = site.domain && site.domain.trim() ? site.domain : 'unknown';
  const baseRoot = config.isMockMode
    ? path.join(config.rootDir, 'mock_nginx', 'www')
    : path.join(path.sep, 'www');
  const root = path.join(baseRoot, domain);
  await fsp.mkdir(root, { recursive: true, mode: 0o755 });
  return root;
}

module.exports = {
  sites,
  withSitesLock,
  loadSites,
  saveSites,
  genId,
  getSiteRoot,
};
