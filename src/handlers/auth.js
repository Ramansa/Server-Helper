const {
  authenticateUser,
  createSessionToken,
  hasUsers,
  registerUser,
  verifySessionToken,
} = require('../state/users');

const COOKIE_NAME = 'server_helper_session';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return '';
}

function getSessionUser(req) {
  return verifySessionToken(getCookie(req, COOKIE_NAME));
}

function setSessionCookie(res, username) {
  const token = createSessionToken(username);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SECONDS * 1000,
    sameSite: 'lax',
    secure: false,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  });
}

function statusHandler(req, res) {
  const user = getSessionUser(req);
  res.json({
    hasUsers: hasUsers(),
    authenticated: Boolean(user),
    user,
  });
}

async function registerHandler(req, res) {
  try {
    const user = await registerUser(req.body?.username, req.body?.password);
    setSessionCookie(res, user.username);
    res.status(201).json({ user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function loginHandler(req, res) {
  const user = await authenticateUser(req.body?.username, req.body?.password);
  if (!user) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  setSessionCookie(res, user.username);
  res.json({ user });
}

function logoutHandler(req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

module.exports = {
  COOKIE_NAME,
  getCookie,
  getSessionUser,
  loginHandler,
  logoutHandler,
  registerHandler,
  statusHandler,
};
