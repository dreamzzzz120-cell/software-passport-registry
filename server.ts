import 'express-async-errors';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, validateConfiguration } from './src/config.ts';
import { checkDatabaseHealth, closeDatabase } from './src/db/index.ts';
import { rateLimiter } from './src/middleware/security.ts';
import { createConnectRouter } from './src/routes/connect.ts';
import { createMonitoringRouter } from './src/routes/monitoring.ts';
import { createPublicConnectRouter } from './src/routes/public-connect.ts';

const app = express();
const startedAt = Date.now();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '2mb';

if (config.trustProxy) app.set('trust proxy', true);
app.disable('x-powered-by');
if (config.sentry.dsn) Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv, tracesSampleRate: config.isProduction ? 0.1 : 1.0 });

const allowedOrigins = new Set(config.allowedOrigins);
const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
  // Requests without Origin are same-origin/server-to-server or non-browser requests.
  if (!origin) return callback(null, true);
  if (allowedOrigins.has(origin)) return callback(null, true);
  try {
    const requestOrigin = new URL(origin).origin;
    const publicOrigin = new URL(config.publicUrl || origin).origin;
    if (requestOrigin === publicOrigin) return callback(null, true);
  } catch (_) {}
  return callback(new Error('CORS origin denied'));
};

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' } }));
app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID', 'X-API-Key'] }));
app.use(express.json({ limit: requestBodyLimit, strict: true }));
app.use(express.urlencoded({ extended: false, limit: requestBodyLimit }));
app.use((req, res, next) => {
  const supplied = req.headers['x-request-id'];
  const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : `req_${randomUUID()}`;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store, max-age=0' : 'public, max-age=0, must-revalidate');
  res.locals.requestId = requestId;
  next();
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'spr-app', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
app.get('/ready', async (_req, res) => { const database = await checkDatabaseHealth(); const ready = database.ok; res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: { database }, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }); });
app.get('/api/health', async (_req, res) => { const database = await checkDatabaseHealth(); res.status(database.ok ? 200 : 503).json({ status: database.ok ? 'ok' : 'degraded', database }); });
app.use('/api', rateLimiter, createPublicConnectRouter());
app.use('/api/v1', rateLimiter, createConnectRouter());
app.use('/api/connect', rateLimiter, createConnectRouter());
app.use('/api/monitoring', rateLimiter, createMonitoringRouter());

const publicDir = __dirname;
app.use(express.static(publicDir, { index: false, maxAge: config.isProduction ? '1y' : 0 }));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); return res.sendFile(path.join(publicDir, 'index.html'), (error) => error ? next(error) : undefined); });
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const requestId = res.locals.requestId || `req_${randomUUID()}`;
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  console.error('[HTTP_ERROR]', { requestId, status, method: req.method, path: req.path, message: err?.message || String(err) });
  if (config.sentry.dsn) Sentry.captureException(err, { tags: { requestId } });
  return res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED', message: status === 500 ? 'An unexpected server error occurred.' : err?.message || 'Request failed.', requestId } });
});

let server: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;
async function shutdown(signal: string) { if (shuttingDown) return; shuttingDown = true; console.info(`[SPR] ${signal} received; shutting down gracefully.`); const forceTimer = setTimeout(() => process.exit(1), 15_000); forceTimer.unref(); if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); await closeDatabase().catch((error) => console.error('[SPR] Database shutdown error:', error)); if (config.sentry.dsn) await Sentry.close(2_000).catch(() => undefined); clearTimeout(forceTimer); process.exit(0); }
export async function startServer() { validateConfiguration(); const host = process.env.HOST || '0.0.0.0'; server = app.listen(config.port, host, () => console.info(`[SPR] listening on http://${host}:${config.port}`)); return server; }
process.once('SIGTERM', () => void shutdown('SIGTERM')); process.once('SIGINT', () => void shutdown('SIGINT')); process.on('unhandledRejection', (reason) => console.error('[SPR] Unhandled rejection:', reason)); process.on('uncaughtException', (error) => { console.error('[SPR] Uncaught exception:', error); void shutdown('uncaughtException'); });
if (process.env.SPR_SKIP_AUTOSTART !== 'true') void startServer().catch((error) => { console.error('[SPR] Startup failed:', error); process.exit(1); });
export { app };
