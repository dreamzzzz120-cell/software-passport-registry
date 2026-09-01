# Software Passport Registry (SPR)

Global software trust infrastructure for managing and verifying software passports with comprehensive security scanning, compliance monitoring, and trust scoring.

## Quick Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Worker

```bash
npm run worker:dev
```

## Testing

```bash
npm test
```

## Environment Variables

See `.env.example` for all required environment variables.

## Docker

```bash
docker-compose up
```

## Deployment

- **Railway**: `railway.toml` configured for production
- **Vercel**: `vercel.json` configured for frontend
- **Docker**: Multi-stage builds for optimized images

## Hardened production status — 2026-08-22

- Main branch hardened Command Center is merged.
- Dead legacy dashboard/evidence views removed.
- Production verification: 22 test files / 121 tests passing.
- Railway production app and worker deployments verified successful.
- Database migration runner reports zero errors.
- Firebase Admin and Redis rate limiting are active in the production container.
- Vercel Git integration uses this repository; this commit is intentionally present to synchronize the final hardened `main` head to Vercel.
- Client boot failures now render an explicit diagnostic state instead of a blank screen.

<!-- Railway source-sync trigger: 2026-08-18T06:00:00Z -->
<!-- Verification repair runner trigger: 2026-09-01 -->
