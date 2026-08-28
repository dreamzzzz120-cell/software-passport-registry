import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, validateConfiguration } from './src/config.ts';
import { checkDatabaseHealth, closeDatabase, db } from './src/db/index.ts';
import { sql } from 'drizzle-orm';
import { AuthenticatedRequest, rateLimiter, requireAuth, requireRole } from './src/middleware/security.ts';
import { createAuthRouter } from './src/routes/auth.ts';
import { createConnectRouter } from './src/routes/connect.ts';
import { createIntegrationsRouter } from './src/routes/integrations.ts';
import { createLiveIntegrationsRouter } from './src/routes/integrations-live.ts';
import { createMonitoringRouter } from './src/routes/monitoring.ts';
import { createPublicConnectRouter } from './src/routes/public-connect.ts';
import { createScansRouter } from './src/routes/scans.ts';
import { createComplianceRouter } from './src/routes/compliance.ts';
import { createTrustLoopRouter } from './src/routes/trust-loop.ts';
import { createIntegrationMonitoringRouter } from './src/routes/integration-monitoring.ts';
import { createAgentApiRouter } from './src/routes/agent-api.ts';
import { createMspRouter } from './src/routes/msp.ts';
import { createAiTrustRouter } from './src/routes/ai-trust.ts';
import { createBillingRouter, stripeWebhookHandler } from './src/routes/billing.ts';
import { createVendorsRouter } from './src/routes/vendors.ts';
import { createQuestionnairesRouter } from './src/routes/questionnaires.ts';
import { createSavingsRouter } from './src/routes/savings.ts';
import { createGovernanceRouter } from './src/routes/governance.ts';
import { createMcpTransport } from './src/mcp/transport.ts';
import { executePublicMcpTool } from './src/mcp/execute.ts';

const app = express();
const startedAt = Date.now();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '2mb';
const requestHeaderTimeoutMs = Number(process.env.REQUEST_HEADER_TIMEOUT_MS || 15_000);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
const keepAliveTimeoutMs = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65_000);

async function ensureInitialSelfPassport() {
  const owner = (await db.execute(sql`SELECT tenant_id AS "tenantId" FROM users WHERE role = 'Owner' ORDER BY created_at ASC LIMIT 1`)).rows?.[0] as { tenantId?: string } | undefined;
  if (!owner?.tenantId) {
    console.warn('[SPR] Initial self-passport skipped: no Owner tenant exists yet.');
    return;
  }
  // Scores are NULL/'unverified', not a fabricated 0 -- evidence collection
  // is pending, not "confirmed untrustworthy". The canonical scorer
  // (src/trust/scoring-engine.ts) is the only place that assigns a real score.
  await db.execute(sql`
    INSERT INTO passports (
      id, tenant_id, name, version, publisher, category, overall_score,
      security_score, compliance_score, vendor_reputation_score,
      verification_status, release_date,
      file_hash, license_type, ai_summary, sbom, evidence, vulnerabilities, timeline
    ) VALUES (
      'passport_spr_self', ${owner.tenantId}, 'Software Passport Registry', '1.0.0',
      'SPR', 'Platform', NULL, NULL, NULL, NULL, 'unverified', CURRENT_DATE::text, 'not-observed',
      'Unknown', 'Initial SPR self-passport. Evidence collection is pending.',
      '[]', '[]', '[]', '[]'
    )
    ON CONFLICT (id) DO NOTHING
  `);
  console.info('[SPR] Initial self-passport ready.');
}

export function normalizeAllowedOrigins(origins: string[]): string[] {
  return [...new Set(origins.map((origin) => new URL(origin).origin))].sort();
}

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
if (config.sentry.dsn) Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv, tracesSampleRate: config.isProduction ? 0.1 : 1.0 });
const allowedOrigins = new Set(normalizeAllowedOrigins(config.allowedOrigins));
const appOrigin = config.appUrl ? new URL(config.appUrl).origin : undefined;
// Every Vercel deploy of this project (preview or production) gets its own
// unique-hash subdomain, e.g. software-passport-registry-ff1zu4h0c-sprteam.vercel.app,
// none of which can be enumerated in allowedOrigins ahead of time. Vercel
// itself controls issuance of subdomains under vercel.app, so trusting any
// hostname ending in exactly "-sprteam.vercel.app" (this project's team
// slug) is scoped to deployments this team owns -- not a blanket *.vercel.app
// trust, which would accept any other tenant's Vercel project too.
const VERCEL_TEAM_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+-sprteam\.vercel\.app$/i;
const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
  if (!origin) return callback(null, true);
  try {
    const normalizedOrigin = new URL(origin).origin;
    if (allowedOrigins.has(normalizedOrigin)) return callback(null, true);
    if (VERCEL_TEAM_PREVIEW_ORIGIN.test(normalizedOrigin)) return callback(null, true);
  } catch (_) {}
  return callback(new Error('CORS origin denied'));
};
app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:'], fontSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", ...(appOrigin ? [appOrigin] : [])], frameSrc: ["'self'", 'https:'], workerSrc: ["'self'", 'blob:'], manifestSrc: ["'self'"], upgradeInsecureRequests: [] } }, crossOriginEmbedderPolicy: false, frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' } }));
app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID', 'X-API-Key'] }));
app.use((req, res, next) => { if (req.method === 'TRACE' || req.method === 'CONNECT') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'HTTP method is not allowed.' } }); if (req.headers['content-length'] && !/^\d+$/.test(String(req.headers['content-length']))) return res.status(400).json({ error: { code: 'INVALID_CONTENT_LENGTH', message: 'Invalid Content-Length header.' } }); return next(); });
// Stripe's signature verification needs the exact raw request bytes, so this
// must be registered with express.raw() before the global express.json()
// below parses (and discards) the raw body for every other route.
app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: requestBodyLimit }), stripeWebhookHandler);
app.use(express.json({ limit: requestBodyLimit, strict: true, type: ['application/json', 'application/*+json'] }));
app.use(express.urlencoded({ extended: false, limit: requestBodyLimit }));
app.use((req, res, next) => { const supplied = req.headers['x-request-id']; const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : `req_${randomUUID()}`; res.setHeader('X-Request-ID', requestId); res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store, max-age=0' : 'public, max-age=0, must-revalidate'); res.locals.requestId = requestId; next(); });
app.use((req, res, next) => { if (config.isProduction && config.enforceHttps && !req.secure && req.path !== '/health' && req.path !== '/ready' && req.path !== '/api/health') { if (!appOrigin) return res.status(503).json({ error: { code: 'HTTPS_CONFIGURATION_ERROR', message: 'HTTPS redirect target is not configured.' } }); return res.redirect(308, `${appOrigin}${req.originalUrl}`); } return next(); });
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'spr-app', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
app.get('/ready', async (_req, res) => { const database = await checkDatabaseHealth(); const ready = database.ok; res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: { database: database.ok ? database : { ok: false, latencyMs: database.latencyMs, error: 'DATABASE_UNAVAILABLE' } }, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }); });
app.get('/api/health', async (_req, res) => { const database = await checkDatabaseHealth(); res.status(database.ok ? 200 : 503).json({ status: database.ok ? 'ok' : 'degraded', database: database.ok ? database : { ok: false, latencyMs: database.latencyMs, error: 'DATABASE_UNAVAILABLE' } }); });
app.use('/api', rateLimiter);
app.use('/api', createAuthRouter());
app.use('/api', createPublicConnectRouter());
const connectRouter = createConnectRouter();
app.use('/api', connectRouter);
app.use('/api/connect', connectRouter);
app.use('/api/integrations/connect', connectRouter);
app.post('/api/ai/analyze-passport', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const passportId = typeof req.body?.passportId === 'string' ? req.body.passportId.trim() : '';
    if (!passportId) return res.status(400).json({ error: { code: 'PASSPORT_ID_REQUIRED', message: 'passportId is required.' } });
    const db = req.db!;
    const result = await db.execute(sql`
      SELECT name, version, publisher, overall_score AS "overallScore",
             jsonb_array_length(COALESCE(NULLIF(evidence, '')::jsonb, '[]'::jsonb)) AS "evidenceCount",
             jsonb_array_length(COALESCE(NULLIF(vulnerabilities, '')::jsonb, '[]'::jsonb)) AS "findingCount"
      FROM passports
      WHERE id = ${passportId} AND tenant_id = ${req.user!.tenantId}
      LIMIT 1
    `);
    const passport = (result.rows?.[0] ?? null) as { name?: string; version?: string; publisher?: string; overallScore?: number | null; evidenceCount?: number; findingCount?: number } | null;
    if (!passport) return res.status(404).json({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passport not found.' } });
    const status = passport.overallScore == null ? 'not verified' : `score ${passport.overallScore}`;
    return res.json({ passportId, analysis: `${passport.name ?? 'Passport'} ${passport.version ?? ''} by ${passport.publisher ?? 'unknown publisher'} is ${status}. Evidence records: ${passport.evidenceCount ?? 0}. Findings: ${passport.findingCount ?? 0}. Authoritative verification requires durable backend evidence.` });
  } catch (error) { return next(error); }
});
app.use('/api/integrations', createIntegrationsRouter());
app.use('/api/integrations-live', createLiveIntegrationsRouter());
// A 'Client'-role user may only sign off on remediation work already
// verified by staff (POST /remediations/:id/approve) -- every other
// mutation under this router still requires an internal staff role.
const requireTrustMutationRole = (req: Request, res: Response, next: NextFunction) => { if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(); if (req.method === 'POST' && /\/remediations\/[^/]+\/approve$/.test(req.path)) return requireRole(['Owner', 'Admin', 'Operator', 'Technician', 'Client'])(req as AuthenticatedRequest, res, next); return requireRole(['Owner', 'Admin', 'Operator', 'Technician'])(req as AuthenticatedRequest, res, next); };
app.use('/api/trust-loop', requireAuth, requireTrustMutationRole);
app.use('/api/trust-loop', createTrustLoopRouter());
app.use('/api/integration-monitoring', createIntegrationMonitoringRouter());
app.use('/api/monitoring', createMonitoringRouter());
app.use('/api/agent/v1', createAgentApiRouter());
app.use('/api/msp', requireAuth, createMspRouter());
app.use('/api/billing', createBillingRouter());
app.use('/api/vendors', createVendorsRouter());
app.use('/api/questionnaires', createQuestionnairesRouter());
app.use('/api/savings', createSavingsRouter());
app.use('/api/governance', createGovernanceRouter());
app.use('/api/ai-trust', requireAuth, createAiTrustRouter());

const mcpBearer = process.env.SPR_MCP_BEARER_TOKEN;
if (mcpBearer) {
  const mcpTransport = createMcpTransport({ expectedBearer: mcpBearer, executeTool: async (tool, args) => executePublicMcpTool(tool, args) });
  app.post('/mcp', async (req, res) => { const response = await mcpTransport(new Request(`${config.appUrl || 'https://localhost'}/mcp`, { method: 'POST', headers: req.headers as Record<string, string>, body: JSON.stringify(req.body) })); res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value)); res.send(Buffer.from(await response.arrayBuffer())); });
}

app.use('/api', createScansRouter());
app.use('/api/compliance', createComplianceRouter());
// Resolve the static asset root from the process working directory in both
// production CJS and local tsx execution. This avoids import.meta.url in the
// CJS bundle while keeping the deployed /app layout deterministic.
const publicDir = path.resolve(process.cwd());
app.use(express.static(publicDir, { index: false, maxAge: config.isProduction ? '1y' : 0 }));
app.get('/*splat', (req, res, next) => { if (req.path.startsWith('/api/') || req.path === '/mcp') return next(); return res.sendFile(path.join(publicDir, 'index.html'), error => error ? next(error) : undefined); });
app.use((req, res, next) => { if (req.path.startsWith('/api/') || req.path === '/mcp') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId } }); return next(); });
app.use((err: any, req: Request, res: Response, next: NextFunction) => { if (res.headersSent) return next(err); const requestId = res.locals.requestId || `req_${randomUUID()}`; const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500; console.error('[HTTP_ERROR]', { requestId, status, method: req.method, path: req.path, message: err?.message || String(err) }); if (config.sentry.dsn) Sentry.captureException(err, { tags: { requestId } }); return res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED', message: status === 500 ? 'An unexpected server error occurred.' : err?.message || 'Request failed.', requestId } }); });
// Node's http server never dispatches CONNECT to Express's normal request
// handler — it fires a separate 'connect' event on the raw socket instead, so
// the CONNECT rejection in the Express middleware above never actually runs
// for a real CONNECT request. This closes that gap at the socket level.
export function rejectConnectTunnels(target: ReturnType<typeof app.listen>) {
  target.on('connect', (_req, socket) => { socket.end('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); });
  return target;
}
let server: ReturnType<typeof app.listen> | undefined; let shuttingDown = false;
async function shutdown(signal: string) { if (shuttingDown) return; shuttingDown = true; console.info(`[SPR] ${signal} received; shutting down gracefully.`); const forceTimer = setTimeout(() => process.exit(1), 15_000); forceTimer.unref(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await closeDatabase().catch(error => console.error('[SPR] Database shutdown error:', error)); if (config.sentry.dsn) await Sentry.close(2_000).catch(() => undefined); clearTimeout(forceTimer); process.exit(0); }
export async function startServer() { validateConfiguration(); try { await ensureInitialSelfPassport(); } catch (error) { console.error('[SPR] Initial self-passport bootstrap failed; continuing startup. /ready will report the database as unavailable.', error); } const host = process.env.HOST || '0.0.0.0'; server = app.listen(config.port, host, () => console.info(`[SPR] listening on http://${host}:${config.port}`)); rejectConnectTunnels(server); server.requestTimeout = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 120_000; server.headersTimeout = Number.isFinite(requestHeaderTimeoutMs) && requestHeaderTimeoutMs > 0 ? requestHeaderTimeoutMs : 15_000; server.keepAliveTimeout = Number.isFinite(keepAliveTimeoutMs) && keepAliveTimeoutMs > 0 ? keepAliveTimeoutMs : 65_000; return server; }
process.once('SIGTERM', () => void shutdown('SIGTERM')); process.once('SIGINT', () => void shutdown('SIGINT')); process.on('unhandledRejection', reason => console.error('[SPR] Unhandled rejection:', reason)); process.on('uncaughtException', error => { console.error('[SPR] Uncaught exception:', error); void shutdown('uncaughtException'); });
if (process.env.SPR_SKIP_AUTOSTART !== 'true') void startServer().catch(error => { console.error('[SPR] Startup failed:', error); process.exit(1); });
export { app };