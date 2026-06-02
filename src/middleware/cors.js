function corsMiddleware(req, res, next) {
  const origin = req.get('Origin');
  let allowedOrigin = process.env.CORS_ORIGIN;
  if (!allowedOrigin) {
    allowedOrigin = '*';
  }
  if (allowedOrigin === '*') {
    res.set('Access-Control-Allow-Origin', '*');
  } else if (origin === allowedOrigin) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
}

module.exports = { corsMiddleware };
