const {
  withNginxLock,
  loadNginxSettings,
  readNginxMainConfig,
  applyNginxDefaults,
  generateNginxMainConfig,
  writeNginxMainConfig,
  saveNginxSettings,
  reloadNginx,
} = require('../nginx');
const { sendTextError } = require('../utils/http');

async function nginxConfigGetHandler(req, res) {
  try {
    const settings = loadNginxSettings();
    const config = await withNginxLock(() => readNginxMainConfig(settings));
    res.json({ config, settings });
  } catch (error) {
    sendTextError(res, 500, error.message);
  }
}

async function nginxConfigPutHandler(req, res) {
  const body = req.body || {};
  let mode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
  if (!mode) {
    mode = 'gui';
  }

  const settings = applyNginxDefaults(body.settings || {});
  let content;
  if (mode === 'gui') {
    content = generateNginxMainConfig(settings);
  } else if (mode === 'raw') {
    if (!body.config || !body.config.trim()) {
      sendTextError(res, 400, 'nginx.conf content cannot be empty');
      return;
    }
    content = body.config;
  } else {
    sendTextError(res, 400, 'unsupported nginx config mode');
    return;
  }

  try {
    await withNginxLock(() => writeNginxMainConfig(content));
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }

  if (mode === 'gui') {
    try {
      await saveNginxSettings(settings);
    } catch (error) {
      sendTextError(res, 500, error.message);
      return;
    }
  }

  const { output, error } = await reloadNginx();
  if (error) {
    sendTextError(res, 500, output);
    return;
  }

  res.json({ success: true, output });
}

module.exports = {
  nginxConfigGetHandler,
  nginxConfigPutHandler,
};
