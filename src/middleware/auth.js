const crypto = require('crypto');
const { getSessionUser } = require('../handlers/auth');

function isPublicAuthRoute(req) {
  return (
    req.path === '/auth/status' ||
    req.path === '/auth/login' ||
    req.path === '/auth/register' ||
    req.path === '/auth/logout'
  );
}

function isValidApiKey(req) {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) {
    return false;
  }

  const provided = req.get('X-API-Key') || '';
  const expectedBuffer = Buffer.from(apiKey);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function authMiddleware(req, res, next) {
  if (isPublicAuthRoute(req) || isValidApiKey(req)) {
    next();
    return;
  }

  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  req.user = user;
  next();
}

module.exports = { authMiddleware };
