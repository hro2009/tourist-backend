import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { seedDatabase } from './seed.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { parseCookies } from './middleware/auth.js';
import { ApiError, sendError } from './errors.js';
import { verifyStripeSignature } from './services/payments.js';
import { uploadsDirectory } from './uploads.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const frontendOrigins = new Set((process.env.FRONTEND_ORIGINS || '').split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean));
const cookieSameSite = process.env.COOKIE_SAME_SITE || 'strict';
if (!['strict', 'lax', 'none'].includes(cookieSameSite)) throw new Error('COOKIE_SAME_SITE must be strict, lax, or none.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (isProduction) throw new Error('JWT_SECRET must contain at least 32 characters in production.');
  process.env.JWT_SECRET ||= 'development-only-secret-change-before-deploy-123456789';
}

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    if (frontendOrigins.has(origin)) return callback(null, true);
    callback(new ApiError(403, 'Origin is not allowed.', 'CORS_REJECTED'));
  },
  credentials: true
}));
app.use(parseCookies);
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '100kb' }), (req, res, next) => {
  const signature = req.get('stripe-signature');
  if (!verifyStripeSignature(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET)) return next(new ApiError(400, 'Invalid webhook signature.', 'INVALID_SIGNATURE'));
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return next(new ApiError(400, 'Invalid webhook payload.')); }
  if (event.type === 'checkout.session.completed' && event.data?.object?.payment_status === 'paid') {
    const reference = event.data.object.metadata?.booking_reference;
    if (reference) db.prepare("UPDATE bookings SET status='paid',payment_status='paid' WHERE reference=?").run(reference);
  }
  res.json({ received: true });
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const publicPostLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } } });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' } } });
app.use('/api/auth/login', loginLimit);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (req, _res, next) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? publicPostLimit(req, _res, next) : next(), publicRouter);
app.use('/uploads', express.static(uploadsDirectory, { maxAge: isProduction ? '7d' : 0, fallthrough: false }));
app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API endpoint not found.', 'NOT_FOUND')));
app.use(sendError);

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const created = seedDatabase();
  if (created) console.info('Hayq seed data created.');
  if (!db.prepare('SELECT id FROM admin_users LIMIT 1').get()) console.warn('No admin user exists. Configure ADMIN_EMAIL and ADMIN_PASSWORD, then run npm run seed.');
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.info(`Hayq Tours listening on port ${port}`));
}