const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sites, withSitesLock, getSiteRoot } = require('../state/sites');
const { securePath } = require('../utils/paths');
const { stringify, formatPerm, formatDateTime } = require('../utils/format');
const {
  compressZipFile,
  compressGzFile,
  decompressZipFile,
  decompressTarFile,
  decompressGzFile,
} = require('../utils/compress');
const { downloadFromURL } = require('../utils/download');
const { chmodPath } = require('../utils/chmod');
const { sendTextError } = require('../utils/http');

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 << 20 },
});

async function fileRouter(req, res, actionOverride) {
  const siteId = req.params.id;
  const site = await withSitesLock(() => sites.find((entry) => entry.id === siteId));
  if (!site) {
    sendTextError(res, 404, 'Site not found');
    return;
  }

  const siteRoot = await getSiteRoot(site);
  const action = actionOverride || req.params.action || '';

  try {
    switch (action) {
      case 'list':
        await handleFileList(req, res, siteRoot);
        return;
      case 'read':
        await handleFileRead(req, res, siteRoot);
        return;
      case 'write':
        await handleFileWrite(req, res, siteRoot);
        return;
      case 'mkdir':
        await handleFileMkdir(req, res, siteRoot);
        return;
      case 'upload':
        await handleFileUpload(req, res, siteRoot);
        return;
      case 'rename':
        await handleFileRename(req, res, siteRoot);
        return;
      case 'delete':
        await handleFileDelete(req, res, siteRoot);
        return;
      case 'compress':
        await handleFileCompress(req, res, siteRoot);
        return;
      case 'decompress':
        await handleFileDecompress(req, res, siteRoot);
        return;
      case 'download-url':
        await handleFileDownloadURL(req, res, siteRoot);
        return;
      case 'chmod':
        await handleFileChmod(req, res, siteRoot);
        return;
      case 'move':
        await handleFileMove(req, res, siteRoot);
        return;
      default:
        res.sendStatus(404);
    }
  } catch (error) {
    if (!res.headersSent) {
      sendTextError(res, 500, error.message);
    }
  }
}

async function handleFileList(req, res, siteRoot) {
  const subPath = req.query.path || '';
  let absPath;
  try {
    absPath = securePath(siteRoot, subPath);
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  let entries;
  try {
    entries = await fsp.readdir(absPath, { withFileTypes: true });
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }

  const fileList = [];
  for (const entry of entries) {
    let info;
    try {
      info = await fsp.stat(path.join(absPath, entry.name));
    } catch {
      continue;
    }
    const relPath = path
      .relative(siteRoot, path.join(absPath, entry.name))
      .split(path.sep)
      .join('/');
    fileList.push({
      name: entry.name,
      path: relPath,
      size: info.size,
      isDir: entry.isDirectory(),
      perm: formatPerm(info.mode),
      modTime: formatDateTime(info.mtime),
    });
  }

  res.json(fileList);
}

async function handleFileRead(req, res, siteRoot) {
  const subPath = req.query.path || '';
  let absPath;
  try {
    absPath = securePath(siteRoot, subPath);
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  let info;
  try {
    info = await fsp.stat(absPath);
  } catch {
    sendTextError(res, 404, `File not found: ${absPath}`);
    return;
  }

  if (info.isDirectory()) {
    sendTextError(res, 400, 'Cannot read a directory as a file');
    return;
  }

  res.sendFile(absPath);
}

async function handleFileWrite(req, res, siteRoot) {
  let subPath = req.query.path || '';
  let content = '';

  if (typeof req.body === 'string') {
    content = req.body;
  } else if (req.body && typeof req.body === 'object') {
    if (!subPath && req.body.path) {
      subPath = req.body.path;
    }
    content = req.body.content || '';
  }

  let absPath;
  try {
    absPath = securePath(siteRoot, subPath);
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  try {
    const info = await fsp.stat(absPath);
    if (info.isDirectory()) {
      sendTextError(res, 400, 'cannot write content to a directory path');
      return;
    }
  } catch {
    // ignore missing file
  }

  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true, mode: 0o755 });
  } catch (error) {
    sendTextError(res, 500, `failed to create parent directories: ${error.message}`);
    return;
  }

  try {
    await fsp.writeFile(absPath, String(content));
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }

  res.status(200).send('{"success":true}');
}

async function handleFileMkdir(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const nameStr = stringify(req.body.name);
  let absDir;
  try {
    absDir = securePath(siteRoot, path.join(req.body.path || '', nameStr));
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  try {
    await fsp.mkdir(absDir, { recursive: true, mode: 0o755 });
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }
  res.sendStatus(200);
}

async function handleFileUpload(req, res, siteRoot) {
  const subPath = req.query.path || '';
  try {
    securePath(siteRoot, subPath);
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  if (!req.file) {
    sendTextError(res, 400, 'Error retrieving file');
    return;
  }

  const destRel = path.join(subPath, req.file.originalname);
  let absDestPath;
  try {
    absDestPath = securePath(siteRoot, destRel);
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  try {
    await fsp.mkdir(path.dirname(absDestPath), { recursive: true, mode: 0o755 });
    await fsp.writeFile(absDestPath, req.file.buffer, { mode: 0o644 });
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }
  res.sendStatus(200);
}

async function handleFileRename(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const oldNameStr = stringify(req.body.oldName);
  const newNameStr = stringify(req.body.newName);

  let oldAbs;
  let newAbs;
  try {
    oldAbs = securePath(siteRoot, path.join(req.body.path || '', oldNameStr));
    newAbs = securePath(siteRoot, path.join(req.body.path || '', newNameStr));
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  try {
    await fsp.rename(oldAbs, newAbs);
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }
  res.sendStatus(200);
}

async function handleFileDelete(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const nameStr = stringify(req.body.name);
  let absPath;
  try {
    absPath = securePath(siteRoot, path.join(req.body.path || '', nameStr));
  } catch (error) {
    sendTextError(res, 400, error.message);
    return;
  }

  try {
    await fsp.stat(absPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendTextError(res, 404, 'file or directory does not exist');
      return;
    }
    sendTextError(res, 500, error.message);
    return;
  }

  try {
    await fsp.rm(absPath, { recursive: true, force: true });
  } catch (error) {
    sendTextError(res, 500, `failed to delete: ${error.message}`);
    return;
  }
  res.status(200).send('{"success":true}');
}

async function handleFileCompress(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const destRel = path.join(req.body.path || '', req.body.destName || '');
  if (req.body.type === 'zip') {
    const relItems = Array.isArray(req.body.items) ? req.body.items : [];
    const items = relItems.map((item) => path.join(req.body.path || '', item));
    try {
      await compressZipFile(siteRoot, destRel, items);
    } catch (error) {
      sendTextError(res, 500, error.message);
      return;
    }
  } else if (req.body.type === 'gz') {
    if (!req.body.items || req.body.items.length === 0) {
      sendTextError(res, 400, 'no items to compress');
      return;
    }
    const srcRel = path.join(req.body.path || '', req.body.items[0]);
    try {
      await compressGzFile(siteRoot, destRel, srcRel);
    } catch (error) {
      sendTextError(res, 500, error.message);
      return;
    }
  } else {
    sendTextError(res, 400, 'unsupported compression format');
    return;
  }
  res.sendStatus(200);
}

async function handleFileDecompress(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const fileName = req.body.file || '';
  const archiveRel = path.join(req.body.path || '', fileName);

  try {
    if (fileName.endsWith('.zip')) {
      await decompressZipFile(siteRoot, archiveRel, req.body.path || '');
    } else if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
      await decompressTarFile(siteRoot, archiveRel, req.body.path || '', true);
    } else if (fileName.endsWith('.tar')) {
      await decompressTarFile(siteRoot, archiveRel, req.body.path || '', false);
    } else if (fileName.endsWith('.gz')) {
      const destName = fileName.slice(0, -3);
      const destRel = path.join(req.body.path || '', destName);
      await decompressGzFile(siteRoot, archiveRel, destRel);
    } else {
      sendTextError(res, 400, 'unsupported decompression archive');
      return;
    }
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }

  res.sendStatus(200);
}

async function handleFileDownloadURL(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const destRel = path.join(req.body.path || '', req.body.filename || '');
  try {
    await downloadFromURL(siteRoot, req.body.url, destRel);
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }
  res.sendStatus(200);
}

async function handleFileChmod(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const nameStr = stringify(req.body.name);
  const targetRel = path.join(req.body.path || '', nameStr);
  const modeStr = String(req.body.mode);
  const parsedMode = Number.parseInt(modeStr, 8);
  if (Number.isNaN(parsedMode)) {
    sendTextError(res, 400, 'invalid permission format');
    return;
  }

  try {
    await chmodPath(siteRoot, targetRel, parsedMode, Boolean(req.body.recursive));
  } catch (error) {
    sendTextError(res, 500, error.message);
    return;
  }
  res.sendStatus(200);
}

async function handleFileMove(req, res, siteRoot) {
  if (!req.body || typeof req.body !== 'object') {
    sendTextError(res, 400, 'invalid request');
    return;
  }

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for (const item of items) {
    let oldAbs;
    let newAbs;
    try {
      oldAbs = securePath(siteRoot, path.join(req.body.srcPath || '', item));
    } catch (error) {
      sendTextError(res, 400, `invalid source path: ${error.message}`);
      return;
    }
    try {
      newAbs = securePath(siteRoot, path.join(req.body.path || '', item));
    } catch (error) {
      sendTextError(res, 400, `invalid destination path: ${error.message}`);
      return;
    }

    try {
      await fsp.stat(newAbs);
      sendTextError(res, 409, `Conflict: item already exists at destination: ${item}`);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        sendTextError(res, 500, error.message);
        return;
      }
    }

    try {
      await fsp.rename(oldAbs, newAbs);
    } catch (error) {
      sendTextError(res, 500, `failed to move ${item}: ${error.message}`);
      return;
    }
  }

  res.sendStatus(200);
}

module.exports = {
  uploadMiddleware,
  fileRouter,
};
