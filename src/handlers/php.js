const fsp = require('fs/promises');
const { config } = require('../config/paths');

async function phpVersionsHandler(req, res) {
  const versions = [];
  try {
    const entries = await fsp.readdir(config.phpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        versions.push(entry.name);
      }
    }
  } catch {
    // ignore
  }
  res.json(versions);
}

module.exports = { phpVersionsHandler };
