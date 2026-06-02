function stringify(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return String(value);
}

function formatPerm(mode) {
  const perm = mode & 0o777;
  const parts = [
    (perm >> 6) & 7,
    (perm >> 3) & 7,
    perm & 7,
  ];
  let result = '-';
  for (const part of parts) {
    result += part & 4 ? 'r' : '-';
    result += part & 2 ? 'w' : '-';
    result += part & 1 ? 'x' : '-';
  }
  return result;
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
  stringify,
  formatPerm,
  formatDateTime,
};
