const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { X509Certificate } = require('crypto');
const { execFile } = require('child_process');
const { config } = require('../config/paths');
const { createMutex } = require('../utils/mutex');

const withNginxLock = createMutex();

function execCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`;
      resolve({ error, output });
    });
  });
}

function generateNginxConfig(site) {
  const listenPort = site.port || 80;
  const lines = [];
  lines.push('server {');
  lines.push(`    listen ${listenPort};`);

  if (site.ssl) {
    lines.push('    listen 443 ssl http2;');
    lines.push(`    ssl_certificate ${config.nginxSslDir}/${site.domain}.pem;`);
    lines.push(`    ssl_certificate_key ${config.nginxSslDir}/${site.domain}.key;`);
    lines.push('    ssl_protocols TLSv1.2 TLSv1.3;');
    lines.push('    ssl_ciphers HIGH:!aNULL:!MD5;');
  }

  lines.push(`    server_name ${site.domain};`);

  if (site.type === 'proxy') {
    lines.push('');
    lines.push('    location / {');
    lines.push(`        proxy_pass ${site.target};`);
    lines.push('        proxy_set_header Host $host;');
    lines.push('        proxy_set_header X-Real-IP $remote_addr;');
    lines.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    lines.push('        proxy_set_header X-Forwarded-Proto $scheme;');
    lines.push('    }');
  } else {
    lines.push(`    root ${site.target};`);
    lines.push('');
    lines.push('    location / {');
    lines.push('        index index.html index.htm index.php;');
    lines.push('        try_files $uri $uri/ =404;');
    lines.push('    }');
  }

  if (site.type === 'static' && site.phpVersion && site.phpVersion !== 'none') {
    lines.push('');
    lines.push('    location ~ \\.php$ {');
    lines.push('        fastcgi_split_path_info ^(.+\\.php)(/.+)$;');
    lines.push(`        fastcgi_pass unix:/var/run/php/php${site.phpVersion}-fpm.sock;`);
    lines.push('        fastcgi_index index.php;');
    lines.push('        include fastcgi_params;');
    lines.push('        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;');
    lines.push('        fastcgi_param PATH_INFO $fastcgi_path_info;');
    lines.push('    }');
  }

  lines.push('');
  lines.push(`    error_log  /var/log/nginx/${site.domain}.error.log;`);
  lines.push(`    access_log /var/log/nginx/${site.domain}.access.log;`);
  lines.push('}');

  return lines.join('\n') + '\n';
}

async function writeNginxSiteConfig(site) {
  const content = site.customConfig ? site.customConfig : generateNginxConfig(site);
  const filePath = path.join(config.nginxAvailableDir, site.domain);
  const symlinkPath = path.join(config.nginxEnabledDir, site.domain);

  let oldContent;
  let hasOldFile = false;
  try {
    oldContent = await fsp.readFile(filePath, 'utf8');
    hasOldFile = true;
  } catch {
    // ignore
  }

  let hasOldSymlink = false;
  try {
    await fsp.lstat(symlinkPath);
    hasOldSymlink = true;
  } catch {
    // ignore
  }

  await fsp.writeFile(filePath, content);

  if (!config.isMockMode) {
    const { error, output } = await execCommand('nginx', ['-t']);
    if (error) {
      if (hasOldFile) {
        await fsp.writeFile(filePath, oldContent);
      } else {
        await safeRemove(filePath);
      }
      if (!hasOldSymlink) {
        await safeRemove(symlinkPath);
      }
      throw new Error(output.trim() || String(error));
    }
  }

  if (site.enabled) {
    if (!hasOldSymlink) {
      await fsp.symlink(filePath, symlinkPath);
    }
  } else {
    await safeRemove(symlinkPath);
  }
}

async function removeNginxSiteConfig(domain) {
  await safeRemove(path.join(config.nginxAvailableDir, domain));
  await safeRemove(path.join(config.nginxEnabledDir, domain));
}

async function reloadNginx() {
  if (config.isMockMode) {
    return { output: 'Mock mode: Configuration parsed, skipped system reload.', error: null };
  }
  let result = await execCommand('nginx', ['-s', 'reload']);
  if (result.error) {
    result = await execCommand('systemctl', ['reload', 'nginx']);
  }
  return { output: result.output, error: result.error };
}

async function provisionStaticDir(site) {
  if (site.type !== 'static' || !site.target || site.target === '/') {
    return;
  }
  await fsp.mkdir(site.target, { recursive: true, mode: 0o755 });
  const indexPath = path.join(site.target, 'index.html');
  try {
    await fsp.stat(indexPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    const welcomeHTML = `<!DOCTYPE html><html><head><title>Welcome to ${site.domain}</title></head><body><h1>Success!</h1></body></html>`;
    await fsp.writeFile(indexPath, welcomeHTML, 'utf8');
  }
}

function defaultNginxSettings() {
  return {
    workerProcesses: 'auto',
    workerConnections: 1024,
    multiAccept: false,
    keepaliveTimeout: 65,
    clientMaxBodySize: '10m',
    sendfile: true,
    gzip: true,
    gzipMinLength: 1024,
    gzipTypes:
      'text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml',
    serverTokens: false,
    accessLog: true,
    errorLogLevel: 'warn',
  };
}

function applyNginxDefaults(settings) {
  const merged = { ...settings };
  const def = defaultNginxSettings();
  if (!merged.workerProcesses) {
    merged.workerProcesses = def.workerProcesses;
  }
  if (!merged.workerConnections) {
    merged.workerConnections = def.workerConnections;
  }
  if (!merged.keepaliveTimeout) {
    merged.keepaliveTimeout = def.keepaliveTimeout;
  }
  if (!merged.clientMaxBodySize) {
    merged.clientMaxBodySize = def.clientMaxBodySize;
  }
  if (!merged.gzipMinLength) {
    merged.gzipMinLength = def.gzipMinLength;
  }
  if (!merged.gzipTypes) {
    merged.gzipTypes = def.gzipTypes;
  }
  if (!merged.errorLogLevel) {
    merged.errorLogLevel = def.errorLogLevel;
  }
  return merged;
}

function loadNginxSettings() {
  try {
    const data = fs.readFileSync(config.nginxSettingsPath, 'utf8');
    const parsed = JSON.parse(data);
    return applyNginxDefaults(parsed);
  } catch {
    return defaultNginxSettings();
  }
}

async function saveNginxSettings(settings) {
  const data = JSON.stringify(settings, null, 2);
  await fsp.writeFile(config.nginxSettingsPath, data);
}

function generateNginxMainConfig(settings) {
  const applied = applyNginxDefaults(settings);
  const lines = [];
  lines.push('user nginx;');
  lines.push(`worker_processes ${applied.workerProcesses};`);
  lines.push('');
  lines.push('pid /run/nginx.pid;');
  lines.push('');
  lines.push('events {');
  lines.push(`    worker_connections ${applied.workerConnections};`);
  lines.push(`    multi_accept ${applied.multiAccept ? 'on' : 'off'};`);
  lines.push('}');
  lines.push('');
  lines.push('http {');
  lines.push('    include /etc/nginx/mime.types;');
  lines.push('    default_type application/octet-stream;');
  lines.push(`    sendfile ${applied.sendfile ? 'on' : 'off'};`);
  lines.push(`    keepalive_timeout ${applied.keepaliveTimeout};`);
  lines.push(`    client_max_body_size ${applied.clientMaxBodySize};`);
  lines.push(`    server_tokens ${applied.serverTokens ? 'on' : 'off'};`);
  lines.push(`    access_log ${applied.accessLog ? '/var/log/nginx/access.log' : 'off'};`);
  lines.push(`    error_log /var/log/nginx/error.log ${applied.errorLogLevel};`);
  if (applied.gzip) {
    lines.push('    gzip on;');
    lines.push(`    gzip_min_length ${applied.gzipMinLength};`);
    lines.push(`    gzip_types ${applied.gzipTypes};`);
    lines.push('    gzip_vary on;');
    lines.push('    gzip_proxied any;');
  } else {
    lines.push('    gzip off;');
  }
  lines.push('');
  lines.push('    include /etc/nginx/conf.d/*.conf;');
  lines.push(`    include ${config.nginxEnabledDir}/*;`);
  lines.push('}');
  return lines.join('\n') + '\n';
}

async function readNginxMainConfig(settings) {
  try {
    const content = await fsp.readFile(config.nginxConfigPath, 'utf8');
    return content;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return generateNginxMainConfig(settings);
    }
    throw error;
  }
}

async function writeNginxMainConfig(content) {
  let oldContent;
  let hasOldFile = false;
  try {
    oldContent = await fsp.readFile(config.nginxConfigPath, 'utf8');
    hasOldFile = true;
  } catch {
    // ignore
  }

  await fsp.writeFile(config.nginxConfigPath, content);

  if (!config.isMockMode) {
    const { error, output } = await execCommand('nginx', ['-t']);
    if (error) {
      if (hasOldFile) {
        await fsp.writeFile(config.nginxConfigPath, oldContent);
      } else {
        await safeRemove(config.nginxConfigPath);
      }
      throw new Error(output.trim() || String(error));
    }
  }
}


async function getSslCertificateDetails(domain) {
  const certificatePath = path.join(config.nginxSslDir, `${domain}.pem`);
  const keyPath = path.join(config.nginxSslDir, `${domain}.key`);
  const details = {
    domain,
    certificatePath,
    keyPath,
    exists: false,
    subject: '',
    issuer: '',
    validFrom: '',
    validTo: '',
    expired: false,
    daysRemaining: null,
    serialNumber: '',
    fingerprint256: '',
    subjectAltName: '',
  };

  let pem;
  try {
    pem = await fsp.readFile(certificatePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return details;
    }
    throw error;
  }

  const cert = new X509Certificate(pem);
  const expiresAt = new Date(cert.validTo);
  const now = new Date();
  const msRemaining = expiresAt.getTime() - now.getTime();

  details.exists = true;
  details.subject = cert.subject;
  details.issuer = cert.issuer;
  details.validFrom = cert.validFrom;
  details.validTo = cert.validTo;
  details.expired = msRemaining <= 0;
  details.daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  details.serialNumber = cert.serialNumber;
  details.fingerprint256 = cert.fingerprint256;
  details.subjectAltName = cert.subjectAltName || '';

  return details;
}

async function runAcme(domain, action) {
  if (config.isMockMode) {
    return { output: `[Mock] SSL '${action}' for ${domain}`, error: null };
  }

  let args;
  switch (action) {
    case 'install':
      args = ['--issue', '-d', domain, '--nginx', '--log'];
      break;
    case 'renew':
      args = ['--renew', '-d', domain, '--force', '--log'];
      break;
    case 'remove':
      args = ['--remove', '-d', domain];
      break;
    case 'reinstall':
      args = ['--issue', '-d', domain, '--nginx', '--force', '--log'];
      break;
    default:
      return { output: '', error: new Error(`unknown acme action: ${action}`) };
  }

  let acmeBin = 'acme.sh';
  let result = await execCommand(acmeBin, args);
  if (result.error && result.error.code === 'ENOENT') {
    try {
      await fsp.stat('/root/.acme.sh/acme.sh');
      acmeBin = '/root/.acme.sh/acme.sh';
      result = await execCommand(acmeBin, args);
    } catch {
      // ignore fallback
    }
  }

  let output = result.output;
  if (!result.error && ['install', 'reinstall', 'renew'].includes(action)) {
    const keyFile = path.join(config.nginxSslDir, `${domain}.key`);
    const pemFile = path.join(config.nginxSslDir, `${domain}.pem`);
    const installArgs = [
      '--install-cert',
      '-d',
      domain,
      '--key-file',
      keyFile,
      '--fullchain-file',
      pemFile,
      '--reloadcmd',
      'nginx -s reload',
    ];
    const installResult = await execCommand(acmeBin, installArgs);
    output += `\n--- Installation Output ---\n${installResult.output}`;
    if (installResult.error) {
      return { output, error: installResult.error };
    }
  }

  if (action === 'remove') {
    await safeRemove(path.join(config.nginxSslDir, `${domain}.key`));
    await safeRemove(path.join(config.nginxSslDir, `${domain}.pem`));
  }

  return { output, error: result.error };
}

async function safeRemove(targetPath) {
  try {
    await fsp.rm(targetPath, { force: true, recursive: false });
  } catch {
    // ignore
  }
}

module.exports = {
  withNginxLock,
  generateNginxConfig,
  writeNginxSiteConfig,
  removeNginxSiteConfig,
  reloadNginx,
  provisionStaticDir,
  defaultNginxSettings,
  applyNginxDefaults,
  loadNginxSettings,
  saveNginxSettings,
  generateNginxMainConfig,
  readNginxMainConfig,
  writeNginxMainConfig,
  runAcme,
  getSslCertificateDetails,
};
