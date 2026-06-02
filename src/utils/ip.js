const net = require('net');

function isPrivateIPv4(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  if (parts[0] === 10) {
    return true;
  }
  if (parts[0] === 127) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 224 && parts[1] === 0 && parts[2] === 0) {
    return true;
  }
  return false;
}

function isPrivateIPv6(host) {
  const normalized = host.toLowerCase();
  if (normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe80::')) {
    return true;
  }
  if (normalized.startsWith('ff02:') || normalized.startsWith('ff02::')) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7);
    return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateIP(host) {
  const ipType = net.isIP(host);
  if (!ipType) {
    return false;
  }
  if (ipType === 4) {
    return isPrivateIPv4(host);
  }
  return isPrivateIPv6(host);
}

module.exports = { isPrivateIP };
