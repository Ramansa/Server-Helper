const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { securePath } = require('./paths');
const { isPrivateIP } = require('./ip');

async function downloadFromURL(siteRoot, urlStr, destRelPath) {
  const destAbs = securePath(siteRoot, destRelPath);
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('only http/https URLs allowed');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https URLs allowed');
  }
  if (isPrivateIP(parsed.hostname)) {
    throw new Error('requests to private/local IP ranges are blocked');
  }

  const response = await fetch(urlStr);
  if (response.status !== 200) {
    throw new Error(`bad status: ${response.status} ${response.statusText}`.trim());
  }
  if (!response.body) {
    throw new Error('bad status: empty response body');
  }

  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destAbs));
}

module.exports = { downloadFromURL };
