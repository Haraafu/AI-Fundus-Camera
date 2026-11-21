import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { ApiError } from './ai-client.js';

const derive = promisify(scrypt);
const COOKIE = 'luxora_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
const publicUser = user => ({ id: user._id, name: user.name, email: user.email });
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const passwordOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, passwordOptions);
  return `${salt}:${key.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  // Missing accounts still perform a full hash to avoid a timing shortcut.
  const [salt, expected] = (encoded || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await passwordHash(password, salt);
  const key = Buffer.from(actual.split(':')[1], 'hex'), comparison = Buffer.from(expected, 'hex');
  return key.length === comparison.length && timingSafeEqual(key, comparison) && Boolean(encoded);
}
function cookieToken(req) {
  const value = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`));
  return value?.slice(COOKIE.length + 1);
}
function credential(req) {
  if (req.headers.authorization !== undefined) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization);
    return { token: match?.[1], bearer: true };
  }
  return { token: cookieToken(req), bearer: false };
}
function writeCookie(req, res, token, maxAge = lifetime) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge });
}
export function createAuthentication(store) {
  const repository = store.auth;
  const authenticate = async (req, res, next) => {
    const { token, bearer } = credential(req);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    const session = await repository.findSession(digest(token));
    const user = session && await repository.findUserById(session.userId);
    if (!user) throw new ApiError(401, 'AUTH_REQUIRED', 'Your session has expired. Please sign in again.');
    req.user = publicUser(user);
    req.sessionId = session._id;
    req.bearer = bearer;
    req.store = store.forUser(user._id);
    next();
  };
  const protectMutation = (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const { bearer } = credential(req);
      if (!bearer && (req.get('X-Luxora-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site')) {
        throw new ApiError(403, 'CSRF_REJECTED', 'This request must originate from LUXORA.');
      }
    }
    next();
  };
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(protectMutation);
  const rateLimit = async req => {
    const email = normalizeEmail(req.body?.email);
    const [ipCount, accountCount] = await Promise.all([
      repository.countAttempt(digest(`ip:${req.ip}`)), repository.countAttempt(digest(`email:${email}`))
    ]);
    if (ipCount > 40 || accountCount > 15) throw new ApiError(429, 'AUTH_RATE_LIMIT', 'Too many sign-in attempts. Try again in 15 minutes.');
  };
  const startSession = async (req, res, user, status = 200) => {
    const token = randomBytes(32).toString('base64url');
    await repository.saveSession({ _id: digest(token), userId: user._id, expiresAt: new Date(Date.now() + lifetime), createdAt: new Date() });
    const previous = cookieToken(req);
    if (previous && /^[A-Za-z0-9_-]{43}$/.test(previous)) await repository.deleteSession(digest(previous));
    writeCookie(req, res, token);
    res.status(status).json({ user: publicUser(user) });
  };
  router.post('/register', async (req, res) => {
    await rateLimit(req);
    const email = normalizeEmail(req.body?.email), name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = req.body?.password;
    if (!validEmail(email) || name.length < 2 || name.length > 80 || typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new ApiError(400, 'INVALID_ACCOUNT', 'Provide a name (2–80 characters), a valid email, and a password of 12–128 characters.');
    }
    const hashed = await passwordHash(password);
    let user;
    try { user = await repository.createUser({ name, email, passwordHash: hashed, createdAt: new Date() }); }
    catch (error) {
      if (error.code === 11000) throw new ApiError(409, 'EMAIL_REGISTERED', 'An account with this email already exists.');
      throw error;
    }
    await startSession(req, res, user, 201);
  });
  router.post('/login', async (req, res) => {
    await rateLimit(req);
    const email = normalizeEmail(req.body?.email), password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || password.length > 128) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    const user = await repository.findUserByEmail(email);
    if (!await verifyPassword(password, user?.passwordHash)) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    await startSession(req, res, user);
  });
  router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
  router.post('/logout', authenticate, async (req, res) => {
    await repository.deleteSession(req.sessionId);
    writeCookie(req, res, '', 0);
    res.json({ success: true });
  });
  // An ESP can use this token as a Bearer credential without browser cookies.
  router.post('/device-token', authenticate, async (req, res) => {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + lifetime);
    await repository.saveSession({ _id: digest(token), userId: req.user.id, kind: 'device', createdAt: new Date(), expiresAt });
    res.status(201).json({ token, expiresAt });
  });
  return { router, authenticate, protectMutation };
}
