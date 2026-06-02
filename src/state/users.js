const crypto = require('crypto');
const fsp = require('fs/promises');
const { config } = require('../config/paths');
const { createMutex } = require('../utils/mutex');

const scryptAsync = (...args) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(...args, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });

const userLock = createMutex();
let users = [];
const sessionSecret = crypto.randomBytes(32);

async function loadUsers() {
  try {
    const raw = await fsp.readFile(config.usersPath, 'utf8');
    const parsed = JSON.parse(raw);
    users = Array.isArray(parsed) ? parsed : parsed.users || [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    users = [];
    await saveUsers();
  }
}

async function saveUsers() {
  await fsp.writeFile(config.usersPath, `${JSON.stringify({ users }, null, 2)}\n`, { mode: 0o600 });
}

function hasUsers() {
  return users.length > 0;
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

function validateCredentials(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = String(password || '');

  if (!normalizedUsername) {
    throw new Error('Username is required.');
  }
  if (normalizedUsername.length > 64) {
    throw new Error('Username must be 64 characters or fewer.');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(normalizedUsername)) {
    throw new Error('Username may only contain letters, numbers, dots, dashes, and underscores.');
  }
  if (normalizedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  return { username: normalizedUsername, password: normalizedPassword };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString('base64url')}`;
}

async function verifyPassword(password, passwordHash) {
  const [algorithm, n, r, p, salt, storedKey] = String(passwordHash || '').split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !storedKey) {
    return false;
  }

  const expected = Buffer.from(storedKey, 'base64url');
  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function registerUser(username, password) {
  return userLock(async () => {
    if (hasUsers()) {
      throw new Error('A user already exists. Please log in.');
    }

    const credentials = validateCredentials(username, password);
    const passwordHash = await hashPassword(credentials.password);
    const user = {
      username: credentials.username,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    await saveUsers();
    return { username: user.username, createdAt: user.createdAt };
  });
}

async function authenticateUser(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const user = users.find((entry) => entry.username === normalizedUsername);
  if (!user) {
    return null;
  }

  const valid = await verifyPassword(String(password || ''), user.passwordHash);
  if (!valid) {
    return null;
  }

  return { username: user.username, createdAt: user.createdAt };
}

function createSessionToken(username) {
  const payload = Buffer.from(JSON.stringify({ username, issuedAt: Date.now() })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.issuedAt || Date.now() - parsed.issuedAt > 1000 * 60 * 60 * 24 * 7) {
      return null;
    }

    const user = users.find((entry) => entry.username === parsed.username);
    if (!user) {
      return null;
    }
    return { username: user.username, createdAt: user.createdAt };
  } catch (error) {
    return null;
  }
}

module.exports = {
  authenticateUser,
  createSessionToken,
  hasUsers,
  loadUsers,
  registerUser,
  verifySessionToken,
};
