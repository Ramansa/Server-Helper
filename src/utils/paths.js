const path = require('path');

function normalizeSubPath(subPath) {
  const raw = Array.isArray(subPath) ? subPath[0] : subPath;
  if (raw === undefined || raw === null) {
    return '';
  }
  let value = String(raw);
  if (!value) {
    return '';
  }
  value = value.replace(/^[a-zA-Z]:[\\/]+/, '');
  value = value.replace(/^[\\/]+/, '');
  return value;
}

function securePath(siteRoot, subPath = '') {
  const normalizedSubPath = normalizeSubPath(subPath);
  const joined = path.resolve(siteRoot, normalizedSubPath);
  const root = path.resolve(siteRoot);
  if (joined !== root && !joined.startsWith(root + path.sep)) {
    throw new Error('directory traversal attempt blocked');
  }
  return joined;
}

module.exports = { securePath };
