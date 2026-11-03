# Hayq Tours API

Standalone Express API for the Hayq Tours frontend. It provides public tour and booking endpoints, owner/admin endpoints, Stripe webhook handling, and uploaded image hosting.

## Local setup

1. Use Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a unique `JWT_SECRET`, `ADMIN_EMAIL`, and strong `ADMIN_PASSWORD`.
4. Set `FRONTEND_ORIGINS` to the exact origin(s) where the frontend and admin are hosted.
5. Run `npm run seed`, then `npm start`.
6. Check `GET /api/health`.

The database defaults to `data/hayq.sqlite`; uploaded images default to `uploads/`. Keep `.env`, the database, backups, and uploaded originals private and out of source control.

## Frontend connection and admin cookies

Set `FRONTEND_ORIGINS` to a comma-separated allowlist of complete origins, without paths. The API allows credentialed CORS only from these origins. The frontend's `config.js` must set `window.HAYQ_API_BASE_URL` to this API's origin (for example, `https://api.example.com`).

For cookie-based admin sessions, host the frontend and API on the same site, preferably sibling subdomains such as `www.example.com` and `api.example.com`, and keep `COOKIE_SAME_SITE=strict`. If the hosts are on different sites, use HTTPS and `COOKIE_SAME_SITE=none`; browsers may still block cross-site cookies, so this setup is not recommended.

## Deployment

Use Node.js 20+, a persistent writable volume, and one app instance. Set `NODE_ENV=production`, `DATABASE_PATH`, `UPLOADS_DIR`, a random `JWT_SECRET` of at least 32 characters, `FRONTEND_ORIGINS`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the host dashboard. Set `PUBLIC_URL` to the frontend origin for payment redirects. Never commit secrets or production data.

Run `npm install` during the build and `npm start` as the start command. Seed the first database with `npm run seed`. Configure the payment provider and email variables only when those features are needed. Do not scale the SQLite deployment to multiple replicas.

Run `npm test` for the API integration suite.
