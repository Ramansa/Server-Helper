const {
  sites,
  withSitesLock,
  saveSites,
  genId,
} = require('../state/sites');
const {
  writeNginxSiteConfig,
  removeNginxSiteConfig,
  reloadNginx,
  provisionStaticDir,
  runAcme,
  getSslCertificateDetails,
} = require('../nginx');
const { sendTextError } = require('../utils/http');

function createNotFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function listSitesHandler(req, res) {
  const list = await withSitesLock(() => [...sites]);
  res.json(list);
}

async function createSiteHandler(req, res) {
  const site = req.body || {};
  try {
    await withSitesLock(async () => {
      site.id = genId();
      site.acmeStatus = 'none';
      await writeNginxSiteConfig(site);
      await provisionStaticDir(site);
      await reloadNginx();
      sites.push(site);
      await saveSites();
    });
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }
  res.status(201).json(site);
}

async function updateSiteHandler(req, res) {
  const id = req.params.id;
  const updatedSite = req.body || {};
  try {
    await withSitesLock(async () => {
      const index = sites.findIndex((site) => site.id === id);
      if (index === -1) {
        throw createNotFoundError('Site not found');
      }
      updatedSite.id = sites[index].id;
      updatedSite.acmeStatus = sites[index].acmeStatus;
      updatedSite.acmeLog = sites[index].acmeLog;
      await writeNginxSiteConfig(updatedSite);
      await provisionStaticDir(updatedSite);
      sites[index] = updatedSite;
      await reloadNginx();
      await saveSites();
    });
  } catch (error) {
    if (error.status === 404) {
      sendTextError(res, 404, error.message);
      return;
    }
    sendTextError(res, 500, error.message);
    return;
  }
  res.status(200).json(updatedSite);
}

async function deleteSiteHandler(req, res) {
  const id = req.params.id;
  try {
    await withSitesLock(async () => {
      const index = sites.findIndex((site) => site.id === id);
      if (index === -1) {
        throw createNotFoundError('Site not found');
      }
      await removeNginxSiteConfig(sites[index].domain);
      sites.splice(index, 1);
      await saveSites();
      await reloadNginx();
    });
  } catch (error) {
    if (error.status === 404) {
      sendTextError(res, 404, error.message);
      return;
    }
    sendTextError(res, 500, error.message);
    return;
  }
  res.status(200).json({ message: 'deleted successfully' });
}

async function toggleSiteHandler(req, res) {
  const id = req.params.id;
  let updated;
  try {
    await withSitesLock(async () => {
      const index = sites.findIndex((site) => site.id === id);
      if (index === -1) {
        throw createNotFoundError('Site not found');
      }
      sites[index].enabled = !sites[index].enabled;
      await writeNginxSiteConfig(sites[index]);
      await reloadNginx();
      await saveSites();
      updated = sites[index];
    });
  } catch (error) {
    if (error.status === 404) {
      sendTextError(res, 404, error.message);
      return;
    }
    sendTextError(res, 500, error.message);
    return;
  }
  res.json(updated);
}

async function sslSiteHandler(req, res) {
  const id = req.params.id;
  const body = req.body || {};
  if (!body || typeof body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const action = req.method === 'GET' ? 'view' : body.action;
  const readOnlyActions = new Set(['view']);
  const writeActions = new Set(['install', 'renew', 'remove', 'reinstall']);
  if (!readOnlyActions.has(action) && !writeActions.has(action)) {
    sendTextError(res, 400, `unknown SSL action: ${action || 'none'}`);
    return;
  }

  let domain;
  let siteSnapshot;
  try {
    await withSitesLock(async () => {
      const site = sites.find((entry) => entry.id === id);
      if (!site) {
        throw createNotFoundError('Site not found');
      }
      domain = site.domain;
      siteSnapshot = { ...site };
      if (writeActions.has(action)) {
        site.acmeStatus = 'issuing';
        await saveSites();
      }
    });
  } catch (error) {
    if (error.status === 404) {
      sendTextError(res, 404, error.message);
      return;
    }
    sendTextError(res, 500, error.message);
    return;
  }

  if (action === 'view') {
    try {
      const certificate = await getSslCertificateDetails(domain);
      res.json({ success: true, site: siteSnapshot, certificate });
    } catch (error) {
      sendTextError(res, 500, error.message);
    }
    return;
  }

  const { output, error } = await runAcme(domain, action);

  try {
    await withSitesLock(async () => {
      const index = sites.findIndex((site) => site.id === id);
      if (index === -1) {
        throw createNotFoundError('Site deleted during SSL operation');
      }
      sites[index].acmeLog = output;
      if (error) {
        sites[index].acmeStatus = 'failed';
        sites[index].ssl = false;
        await saveSites();
        return;
      }
      if (action === 'remove') {
        sites[index].acmeStatus = 'none';
        sites[index].ssl = false;
      } else {
        sites[index].acmeStatus = 'active';
        sites[index].ssl = true;
      }
      await writeNginxSiteConfig(sites[index]);
      await reloadNginx();
      await saveSites();
    });
  } catch (lockError) {
    if (lockError.status === 404) {
      sendTextError(res, 404, lockError.message);
      return;
    }
    sendTextError(res, 500, lockError.message);
    return;
  }

  if (error) {
    res.status(500).json({ success: false, output, error: error.message });
    return;
  }

  res.json({ success: true, output });
}

module.exports = {
  listSitesHandler,
  createSiteHandler,
  updateSiteHandler,
  deleteSiteHandler,
  toggleSiteHandler,
  sslSiteHandler,
};
