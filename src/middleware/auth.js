const crypto = require('crypto');

function authMiddleware(req, res, next) {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) {
    next();
    return;
  }
  const provided = req.get('X-API-Key') || '';
  const expectedBuffer = Buffer.from(apiKey);
  const providedBuffer = Buffer.from(provided);
  const valid =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  if (!valid) {
    res.status(401).send('unauthorized');
    return;
  }
  next();
}

module.exports = { authMiddleware };
