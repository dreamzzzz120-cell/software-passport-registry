import 'express-async-errors';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, validateConfiguration } from './src/config.ts';
import { checkDatabaseHealth, closeDatabase } from './src/db/index.ts';
import { AuthenticatedRequest, rateLimiter, requireAuth, requireRole } from './src/middleware/security.ts';
import { createAuthRouter } from './src/routes/auth.ts';
import { createConnectRouter } from './src/routes/connect.ts';
import { createIntegrationsRouter } from './src/routes/integrations.ts';
import { createLiveIntegrationsRouter } from './src/routes/integrations-live.ts';
import { createMonitoringRouter } from './src/routes/monitoring.ts';
import { createPublicConnectRouter } from './src/routes/public-connect.ts';
import { createScansRouter } from './src/routes/scans.ts';
import { createTrustLoopRouter } from './src/routes/trust-loop.ts';
import { createIntegrationMonitoringRouter } from './src/routes/integration-monitoring.ts';
import { createAgentApiRouter } from './src/routes/agent-api.ts';
import { createMcpTransport } from './src/mcp/transport.ts';
import { executePublicMcpTool } from './src/mcp/execute.ts';

const app = express();
const startedAt = Date.now();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '2mb';
// Railway/Vercel places a single known reverse-proxy hop in front of the app.
// Never trust arbitrary forwarded hops: Express proxy trust affects req.ip,
// req.secure and therefore rate limiting and HTTPS enforcement.
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
if (config.sentry.dsn) Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv, tracesSampleRate: config.isProduction ? 0.1 : 1.0 });
const allowedOrigins = new Set(config.allowedOrigins);
const appOrigin = config.appUrl ? new URL(config.appUrl).origin : undefined;
const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
  if (!origin) return callback(null, true);
  try { const normalizedOrigin = new URL(origin).origin; if (allowedOrigins.has(normalizedOrigin) || normalizedOrigin === appOrigin) return callback(null, true); } catch (_) {}
  return callback(new Error('CORS origin denied'));
};
app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:'], fontSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", ...(appOrigin ? [appOrigin] : [])], frameSrc: ["'self'", 'https:'], workerSrc: ["'self'", 'blob:'], manifestSrc: ["'self'"], upgradeInsecureRequests: [] } }, crossOriginEmbedderPolicy: false, frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' } }));
app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID', 'X-API-Key'] }));
app.use(express.json({ limit: requestBodyLimit, strict: true }));
app.use(express.urlencoded({ extended: false, limit: requestBodyLimit }));
app.use((req, res, next) => { const supplied = req.headers['x-request-id']; const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : `req_${randomUUID()}`; res.setHeader('X-Request-ID', requestId); res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store, max-age=0' : 'public, max-age=0, must-revalidate'); res.locals.requestId = requestId; next(); });
app.use((req, res, next) => { if (config.isProduction && config.enforceHttps && !req.secure && req.path !== '/health' && req.path !== '/ready' && req.path !== '/api/health') { if (!appOrigin) return res.status(503).json({ error: { code: 'HTTPS_CONFIGURATION_ERROR', message: 'HTTPS redirect target is not configured.' } }); return res.redirect(308, `${appOrigin}${req.originalUrl}`); } return next(); });
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'spr-app', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
app.get('/ready', async (_req, res) => { const database = await checkDatabaseHealth(); const ready = database.ok; res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: { database }, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }); });
app.get('/api/health', async (_req, res) => { const database = await checkDatabaseHealth(); res.status(database.ok ? 200 : 503).json({ status: database.ok ? 'ok' : 'degraded', database }); });
app.use('/api', rateLimiter);
app.use('/api', createAuthRouter());
app.use('/api', createPublicConnectRouter());
app.use('/api', createConnectRouter());
app.use('/api/connect', createConnectRouter());
app.use('/api/integrations', createIntegrationsRouter());
app.use('/api/integrations-live', createLiveIntegrationsRouter());
const requireTrustMutationRole = (req: Request, res: Response, next: NextFunction) => { if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(); return requireRole(['Owner', 'Admin', 'Operator', 'Technician'])(req as AuthenticatedRequest, res, next); };
app.use('/api/trust-loop', requireAuth, requireTrustMutationRole);
app.use('/api/trust-loop', createTrustLoopRouter());
app.use('/api/integration-monitoring', createIntegrationMonitoringRouter());
app.use('/api/monitoring', createMonitoringRouter());
app.use('/api/agent/v1', createAgentApiRouter());

const mcpBearer = process.env.SPR_MCP_BEARER_TOKEN;
if (mcpBearer) {
  const mcpTransport = createMcpTransport({ expectedBearer: mcpBearer, executeTool: async (tool, args) => executePublicMcpTool(tool, args) });
  app.post('/mcp', async (req, res) => {
    const response = await mcpTransport(new Request(`${config.appUrl || 'https://localhost'}/mcp`, { method: 'POST', headers: req.headers as Record<string, string>, body: JSON.stringify(req.body) }));
    res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value)); res.send(Buffer.from(await response.arrayBuffer()));
  });
}

app.use('/api', createScansRouter());
const publicDir = __dirname;
app.use(express.static(publicDir, { index: false, maxAge: config.isProduction ? '1y' : 0 }));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/') || req.path === '/mcp') return next(); return res.sendFile(path.join(publicDir, 'index.html'), error => error ? next(error) : undefined); });
app.use((err: any, req: Request, res: Response, next: NextFunction) => { if (res.headersSent) return next(err); const requestId = res.locals.requestId || `req_${randomUUID()}`; const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500; console.error('[HTTP_ERROR]', { requestId, status, method: req.method, path: req.path, message: err?.message || String(err) }); if (config.sentry.dsn) Sentry.captureException(err, { tags: { requestId } }); return res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED', message: status === 500 ? 'An unexpected server error occurred.' : err?.message || 'Request failed.', requestId } }); });
let server: ReturnType<typeof app.listen> | undefined; let shuttingDown = false;
async function shutdown(signal: string) { if (shuttingDown) return; shuttingDown = true; console.info(`[SPR] ${signal} received; shutting down gracefully.`); const forceTimer = setTimeout(() => process.exit(1), 15_000); forceTimer.unref(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await closeDatabase().catch(error => console.error('[SPR] Database shutdown error:', error)); if (config.sentry.dsn) await Sentry.close(2_000).catch(() => undefined); clearTimeout(forceTimer); process.exit(0); }
export async function startServer() { validateConfiguration(); const host = process.env.HOST || '0.0.0.0'; server = app.listen(config.port, host, () => console.info(`[SPR] listening on http://${host}:${config.port}`)); return server; }
process.once('SIGTERM', () => void shutdown('SIGTERM')); process.once('SIGINT', () => void shutdown('SIGINT')); process.on('unhandledRejection', reason => console.error('[SPR] Unhandled rejection:', reason)); process.on('uncaughtException', error => { console.error('[SPR] Uncaught exception:', error); void shutdown('uncaughtException'); });
if (process.env.SPR_SKIP_AUTOSTART !== 'true') void startServer().catch(error => { console.error('[SPR] Startup failed:', error); process.exit(1); });
export { app };
