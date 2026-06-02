const path = require('path');
const fsp = require('fs/promises');

const rootDir = path.resolve(__dirname, '..', '..');

const config = {
  port: 8080,
  databasePath: path.join(rootDir, 'sites.json'),
  nginxSslDir: '/etc/nginx/ssl',
  nginxAvailableDir: '/etc/nginx/sites-available',
  nginxEnabledDir: '/etc/nginx/sites-enabled',
  nginxConfigPath: '/etc/nginx/nginx.conf',
  nginxSettingsPath: path.join(rootDir, 'nginx_settings.json'),
  phpDir: '/etc/php',
  isMockMode: false,
  rootDir,
};

async function initPaths() {
  try {
    await fsp.mkdir(config.nginxSslDir, { recursive: true, mode: 0o755 });
  } catch (error) {
    console.warn('Warning: /etc/nginx/ssl not writable. Entering Mock Mode.');
    config.isMockMode = true;
    config.nginxAvailableDir = path.join(rootDir, 'mock_nginx', 'sites-available');
    config.nginxEnabledDir = path.join(rootDir, 'mock_nginx', 'sites-enabled');
    config.nginxSslDir = path.join(rootDir, 'mock_nginx', 'ssl');
    config.nginxConfigPath = path.join(rootDir, 'mock_nginx', 'nginx.conf');
    config.phpDir = path.join(rootDir, 'mock_nginx', 'php');
    await fsp.mkdir(path.join(config.phpDir, '8.2'), { recursive: true, mode: 0o755 });
  }

  await fsp.mkdir(config.nginxAvailableDir, { recursive: true, mode: 0o755 });
  await fsp.mkdir(config.nginxEnabledDir, { recursive: true, mode: 0o755 });
  await fsp.mkdir(config.nginxSslDir, { recursive: true, mode: 0o755 });
  await fsp.mkdir(path.dirname(config.nginxConfigPath), { recursive: true, mode: 0o755 });
}

module.exports = {
  config,
  initPaths,
  rootDir,
};
