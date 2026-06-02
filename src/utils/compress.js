const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');
const unzipper = require('unzipper');
const tar = require('tar');
const { pipeline } = require('stream/promises');
const { securePath } = require('./paths');

async function compressZipFile(siteRoot, destZipRel, items) {
  const destAbs = securePath(siteRoot, destZipRel);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  const output = fs.createWriteStream(destAbs);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);

  for (const itemRel of items) {
    let itemAbs;
    try {
      itemAbs = securePath(siteRoot, itemRel);
    } catch {
      continue;
    }
    const stats = await fsp.stat(itemAbs);
    const relPath = path.relative(siteRoot, itemAbs).split(path.sep).join('/');
    if (stats.isDirectory()) {
      archive.directory(itemAbs, relPath);
    } else {
      archive.file(itemAbs, { name: relPath });
    }
  }

  await archive.finalize();
  await done;
}

async function compressGzFile(siteRoot, destGzRel, srcFileRel) {
  const destAbs = securePath(siteRoot, destGzRel);
  const srcAbs = securePath(siteRoot, srcFileRel);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await pipeline(
    fs.createReadStream(srcAbs),
    zlib.createGzip(),
    fs.createWriteStream(destAbs)
  );
}

async function decompressZipFile(siteRoot, srcZipRel, destFolderRel) {
  const srcAbs = securePath(siteRoot, srcZipRel);
  const destAbs = securePath(siteRoot, destFolderRel);

  const directory = await unzipper.Open.file(srcAbs);
  for (const entry of directory.files) {
    const entryPath = entry.path;
    const targetPath = path.resolve(destAbs, entryPath);
    if (targetPath !== destAbs && !targetPath.startsWith(destAbs + path.sep)) {
      throw new Error(`illegal file path in zip: ${entryPath}`);
    }
    if (entry.type === 'Directory') {
      await fsp.mkdir(targetPath, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(targetPath, { mode: entry.props.mode || 0o644 }));
  }
}

async function decompressGzFile(siteRoot, srcGzRel, destFileRel) {
  const srcAbs = securePath(siteRoot, srcGzRel);
  const destAbs = securePath(siteRoot, destFileRel);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await pipeline(
    fs.createReadStream(srcAbs),
    zlib.createGunzip(),
    fs.createWriteStream(destAbs)
  );
}

async function decompressTarFile(siteRoot, srcTarRel, destFolderRel, isGzip) {
  const srcAbs = securePath(siteRoot, srcTarRel);
  const destAbs = securePath(siteRoot, destFolderRel);

  await tar.x({
    file: srcAbs,
    cwd: destAbs,
    gzip: isGzip,
    filter: (entryPath) => {
      const targetPath = path.resolve(destAbs, entryPath);
      if (targetPath !== destAbs && !targetPath.startsWith(destAbs + path.sep)) {
        throw new Error(`illegal file path in tar: ${entryPath}`);
      }
      return true;
    },
    onentry: (entry) => {
      if (entry.type === 'File' && (!entry.mode || entry.mode === 0)) {
        entry.mode = 0o644;
      }
    },
  });
}

module.exports = {
  compressZipFile,
  compressGzFile,
  decompressZipFile,
  decompressGzFile,
  decompressTarFile,
};
