const express = require('express');
const path = require('path');
const apiRouter = require('./src/routes/api');
const { initPaths, config, rootDir } = require('./src/config/paths');
const { loadSites } = require('./src/state/sites');
const { loadUsers } = require('./src/state/users');
const { corsMiddleware } = require('./src/middleware/cors');
const { authMiddleware } = require('./src/middleware/auth');

async function start() {
  await initPaths();
  await loadSites();
  await loadUsers();

  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));
  app.use(express.text({ type: 'text/*', limit: '100mb' }));

  app.use('/api', corsMiddleware, authMiddleware, apiRouter);

  app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  app.use(express.static(rootDir));

  app.listen(config.port, () => {
    console.log(`Server Helper API Server active on: http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
