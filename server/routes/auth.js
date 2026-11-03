import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { clearSession, isTrustedOrigin, issueSession, requireAdmin } from '../middleware/auth.js';

export const authRouter = Router();
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });

authRouter.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  const origin = req.get('origin');
  if (!isTrustedOrigin(origin, req)) return next(new ApiError(403, 'Invalid request origin.', 'CSRF_REJECTED'));
  if (!parsed.success) return next(new ApiError(400, 'Enter a valid email and password.', 'VALIDATION_ERROR'));
  const user = db.prepare('SELECT id,email,password_hash,role FROM admin_users WHERE email=?').get(parsed.data.email.toLowerCase());
  const valid = await bcrypt.compare(parsed.data.password, user?.password_hash || '$2b$12$invalid.invalid.invalid.invalid.invalid.invalid.invalid');
  if (!user || !valid) return next(new ApiError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS'));
  const csrf = issueSession(res, user);
  res.json({ data: { id: user.id, email: user.email, role: user.role, csrf } });
});

authRouter.post('/logout', requireAdmin, (_req, res) => {
  clearSession(res);
  res.json({ data: { logged_out: true } });
});

authRouter.get('/me', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id,email,role FROM admin_users WHERE id=?').get(req.admin.id);
  if (!user) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Session expired.' } });
  res.json({ data: { ...user, csrf: req.cookies?.hayq_csrf } });
});