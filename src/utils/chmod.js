const fsp = require('fs/promises');
const path = require('path');
const { securePath } = require('./paths');

async function chmodPath(siteRoot, targetRel, mode, recursive) {
  const targetAbs = securePath(siteRoot, targetRel);
  if (!recursive) {
    await fsp.chmod(targetAbs, mode);
    return;
  }
  await chmodRecursive(targetAbs, mode);
}

async function chmodRecursive(targetAbs, mode) {
  const stats = await fsp.stat(targetAbs);
  await fsp.chmod(targetAbs, mode);
  if (!stats.isDirectory()) {
    return;
  }
  const entries = await fsp.readdir(targetAbs, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(targetAbs, entry.name);
    if (entry.isDirectory()) {
      await chmodRecursive(fullPath, mode);
    } else {
      await fsp.chmod(fullPath, mode);
    }
  }
}

module.exports = { chmodPath };
