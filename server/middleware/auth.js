import jwt from 'jsonwebtoken';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../errors.js';

const cookieName = 'hayq_session';
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SAME_SITE === 'none', sameSite: process.env.COOKIE_SAME_SITE || 'strict', path: '/' });
const csrfCookieOptions = () => ({ secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SAME_SITE === 'none', sameSite: process.env.COOKIE_SAME_SITE || 'strict', path: '/' });

export function isTrustedOrigin(origin, req) {
  if (!origin || origin === `${req.protocol}://${req.get('host')}`) return true;
  return (process.env.FRONTEND_ORIGINS || '').split(',').map(value => value.trim().replace(/\/$/, '')).includes(origin);
}

export function parseCookies(req, res, next) {
  req.cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(pair => {
    const separator = pair.indexOf('=');
    return [pair.slice(0, separator).trim(), decodeURIComponent(pair.slice(separator + 1).trim())];
  }));
  next();
}

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h', issuer: 'hayq-tours' });
  const csrf = randomBytes(32).toString('hex');
  res.cookie(cookieName, token, { ...cookieOptions(), maxAge: 8 * 60 * 60 * 1000 });
  res.cookie('hayq_csrf', csrf, { ...csrfCookieOptions(), maxAge: 8 * 60 * 60 * 1000 });
  return csrf;
}

export function clearSession(res) {
  res.clearCookie(cookieName, cookieOptions());
  res.clearCookie('hayq_csrf', csrfCookieOptions());
}

function safeEqual(left = '', right = '') {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.[cookieName];
    if (!token) throw new ApiError(401, 'Sign in to continue.', 'AUTH_REQUIRED');
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'hayq-tours' });
    req.admin = { id: Number(payload.sub), role: payload.role };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!isTrustedOrigin(req.get('origin'), req)) throw new ApiError(403, 'Invalid request origin.', 'CSRF_REJECTED');
      if (!safeEqual(req.get('x-csrf-token'), req.cookies?.hayq_csrf)) throw new ApiError(403, 'Invalid CSRF token.', 'CSRF_REJECTED');
    }
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, 'Session expired. Sign in again.', 'AUTH_REQUIRED'));
  }
}

export function requireOwner(req, res, next) {
  if (req.admin?.role !== 'owner') return next(new ApiError(403, 'Owner access is required.', 'OWNER_REQUIRED'));
  next();
}