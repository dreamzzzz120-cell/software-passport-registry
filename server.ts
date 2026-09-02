import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { config, validateConfiguration } from './src/config.ts';
import { appPool, checkDatabaseHealth, closeDatabase, db } from './src/db/index.ts';
import { sql } from 'drizzle-orm';
import { AuthenticatedRequest, rateLimiter, requireAuth, requireRole } from './src/middleware/security.ts';
import { createAuthRouter } from './src/routes/auth.ts';
import { createOrganizationProvisioningRouter } from './src/routes/organization-provisioning.ts';
import { createConnectRouter } from './src/routes/connect.ts';
import { createIntegrationsRouter } from './src/routes/integrations.ts';
import { createLiveIntegrationsRouter } from './src/routes/integrations-live.ts';
import { createMonitoringRouter } from './src/routes/monitoring.ts';
import { createPublicConnectRouter } from './src/routes/public-connect.ts';
import { createFreeReviewRouter } from './src/routes/free-review.ts';
import { createScansRouter } from './src/routes/scans.ts';
import { createComplianceRouter } from './src/routes/compliance.ts';
import { createTrustLoopRouter } from './src/routes/trust-loop.ts';
import { createIntegrationMonitoringRouter } from './src/routes/integration-monitoring.ts';
import { createAgentApiRouter } from './src/routes/agent-api.ts';
import { createMspRouter } from './src/routes/msp.ts';
import { createAiTrustRouter } from './src/routes/ai-trust.ts';
import { createRemediationTasksRouter } from './src/routes/remediation-tasks.ts';
import { createBillingRouter, stripeWebhookHandler } from './src/routes/billing.ts';
import { createVendorsRouter } from './src/routes/vendors.ts';
import { createQuestionnairesRouter } from './src/routes/questionnaires.ts';
import { createSavingsRouter } from './src/routes/savings.ts';
import { createGovernanceRouter } from './src/routes/governance.ts';
import { createPrivacyRouter } from './src/routes/privacy.ts';
import { createCommercialRouter } from './src/routes/commercial.ts';
import { createMcpTransport } from './src/mcp/transport.ts';
import { executePublicMcpTool } from './src/mcp/execute.ts';

const app = express();
const startedAt = Date.now();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '2mb';
const requestHeaderTimeoutMs = Number(process.env.REQUEST_HEADER_TIMEOUT_MS || 15_000);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
const keepAliveTimeoutMs = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65_000);

async function ensureInitialSelfPassport() {
  const ownerResult = await db.execute(sql`SELECT tenant_id AS "tenantId" FROM users WHERE role = 'Owner' ORDER BY created_at ASC LIMIT 1`);
  const rows = Array.isArray((ownerResult as any).rows) ? (ownerResult as any).rows as Array<{ tenantId?: string | null }> : [];
  const owner = rows[0];
  if (!owner?.tenantId) { console.warn('[SPR] Initial self-passport skipped: no Owner tenant exists yet.'); return; }
  await db.execute(sql`INSERT INTO passports (id, tenant_id, name, version, publisher, category, overall_score, security_score, compliance_score, vendor_reputation_score, verification_status, release_date, file_hash, license_type, ai_summary, sbom, evidence, vulnerabilities, timeline) VALUES ('passport_spr_self', ${owner.tenantId}, 'Software Passport Registry', '1.0.0', 'SPR', 'Platform', NULL, NULL, NULL, NULL, 'unverified', CURRENT_DATE::text, 'not-observed', 'Unknown', 'Initial SPR self-passport. Evidence collection is pending.', '[]', '[]', '[]', '[]') ON CONFLICT (id) DO NOTHING`);
  console.info('[SPR] Initial self-passport ready.');
}
export function normalizeAllowedOrigins(origins: string[]): string[] { return [...new Set(origins.map(origin => new URL(origin).origin))].sort(); }
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
if (config.sentry.dsn) Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv, tracesSampleRate: config.isProduction ? 0.1 : 1.0 });
const allowedOrigins = new Set(normalizeAllowedOrigins(config.allowedOrigins));
const appOrigin = config.appUrl ? new URL(config.appUrl).origin : undefined;
const VERCEL_TEAM_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+-sprteam\.vercel\.app$/i;
const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => { if (!origin) return callback(null, true); try { const normalizedOrigin = new URL(origin).origin; if (allowedOrigins.has(normalizedOrigin)) return callback(null, true); if (VERCEL_TEAM_PREVIEW_ORIGIN.test(normalizedOrigin)) return callback(null, true); } catch (_) {} return callback(new Error('CORS origin denied')); };
app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], scriptSrc: ["'self'", "'sha256-kWQT+628v4D1A4MJk9hTD6a0W1AdPlPKtzhPlYKIpZc='"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:'], fontSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", ...(appOrigin ? [appOrigin] : [])], frameSrc: ["'self'", 'https:'], workerSrc: ["'self'", 'blob:'], manifestSrc: ["'self'"], upgradeInsecureRequests: [] } }, crossOriginEmbedderPolicy: false, frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' } }));
app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Authorization','Content-Type','X-Request-ID','X-API-Key'] }));
app.use((req, res, next) => { if (req.method === 'TRACE' || req.method === 'CONNECT') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'HTTP method is not allowed.' } }); if (req.headers['content-length'] && !/^\d+$/.test(String(req.headers['content-length']))) return res.status(400).json({ error: { code: 'INVALID_CONTENT_LENGTH', message: 'Invalid Content-Length header.' } }); return next(); });
app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: requestBodyLimit }), stripeWebhookHandler);
app.use(express.json({ limit: requestBodyLimit, strict: true, type: ['application/json','application/*+json'] }));
app.use(express.urlencoded({ extended: false, limit: requestBodyLimit }));
app.use((req, res, next) => { const supplied = req.headers['x-request-id']; const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : `req_${randomUUID()}`; res.setHeader('X-Request-ID', requestId); res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store, max-age=0' : 'public, max-age=0, must-revalidate'); res.locals.requestId = requestId; next(); });
app.use((req, res, next) => { if (config.isProduction && config.enforceHttps && !req.secure && req.path !== '/health' && req.path !== '/ready' && req.path !== '/api/health') { if (!appOrigin) return res.status(503).json({ error: { code: 'HTTPS_CONFIGURATION_ERROR', message: 'HTTPS redirect target is not configured.' } }); return res.redirect(308, `${appOrigin}${req.originalUrl}`); } return next(); });
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'spr-app', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
// runtimeRole is reported, not gated: it makes a silent fallback to the owner connection
// (see validateConfiguration's APP_DATABASE_URL check) visible to an operator without
// giving the healthcheck a new way to fail a deploy.
app.get('/ready', async (_req, res) => { const database = await checkDatabaseHealth(); let rls = true; if (database.ok) { try { await db.execute(sql`SELECT spr_assert_tenant_rls()`); } catch { rls = false; } } let runtimeRole: string | null = null; if (database.ok) { try { const scoped = await appPool.query('SELECT current_user AS role'); runtimeRole = scoped.rows?.[0]?.role ?? null; } catch { runtimeRole = null; } } const ready = database.ok && rls; res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: { database: database.ok ? database : { ok: false, latencyMs: database.latencyMs, error: 'DATABASE_UNAVAILABLE' }, tenantRls: { ok: rls }, runtimeRole: { role: runtimeRole, leastPrivilege: runtimeRole === 'spr_app_runtime' } }, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }); });
app.get('/api/health', async (_req, res) => { const database = await checkDatabaseHealth(); res.status(database.ok ? 200 : 503).json({ status: database.ok ? 'ok' : 'degraded', database: database.ok ? database : { ok: false, latencyMs: database.latencyMs, error: 'DATABASE_UNAVAILABLE' } }); });
app.use('/api', rateLimiter);
app.use('/api', createAuthRouter());
app.use('/api', createOrganizationProvisioningRouter());
app.use('/api', createPublicConnectRouter());
app.use('/api', createFreeReviewRouter());
const connectRouter = createConnectRouter(); app.use('/api', connectRouter); app.use('/api/connect', connectRouter); app.use('/api/integrations/connect', connectRouter);
app.use('/api/integrations', createIntegrationsRouter());
app.use('/api/integrations-live', createLiveIntegrationsRouter());
const requireTrustMutationRole = (req: Request, res: Response, next: NextFunction) => { if (['GET','HEAD','OPTIONS'].includes(req.method)) return next(); if (req.method === 'POST' && /\/remediations\/[^/]+\/approve$/.test(req.path)) return requireRole(['Owner','Admin','Operator','Technician','Client'])(req as AuthenticatedRequest, res, next); return requireRole(['Owner','Admin','Operator','Technician'])(req as AuthenticatedRequest, res, next); };
app.use('/api/trust-loop', requireAuth, requireTrustMutationRole);
app.use('/api/trust-loop', createTrustLoopRouter());
app.use('/api/integration-monitoring', createIntegrationMonitoringRouter());
app.use('/api/monitoring', createMonitoringRouter());
app.use('/api/agent/v1', createAgentApiRouter());
app.use('/api/msp', requireAuth, createMspRouter());
app.use('/api/billing', createBillingRouter());
app.use('/api/commercial', createCommercialRouter());
app.use('/api/vendors', createVendorsRouter());
app.use('/api/questionnaires', createQuestionnairesRouter());
app.use('/api/savings', createSavingsRouter());
app.use('/api/governance', createGovernanceRouter());
app.use('/api/privacy', createPrivacyRouter());
app.use('/api/ai-trust', requireAuth, createAiTrustRouter());
app.use('/api/remediation-tasks', requireAuth, createRemediationTasksRouter());
const mcpBearer = process.env.SPR_MCP_BEARER_TOKEN;
if (mcpBearer) { const mcpTransport = createMcpTransport({ expectedBearer: mcpBearer, executeTool: async (tool, args) => executePublicMcpTool(tool, args) }); app.post('/mcp', async (req, res) => { const response = await mcpTransport(new Request(`${config.appUrl || 'https://localhost'}/mcp`, { method: 'POST', headers: req.headers as Record<string, string>, body: JSON.stringify(req.body) })); res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value)); res.send(Buffer.from(await response.arrayBuffer())); }); }
app.use('/api', createScansRouter());
app.use('/api/compliance', createComplianceRouter());
// `vite build` writes the client bundle to dist/, and scripts/prerender-public-routes.mjs
// writes dist/<route>/index.html on top of it. Serving process.cwd() instead served the
// repository's *source* index.html, whose script tag is "/src/main.tsx" -- a path that does
// not exist in the runtime image. The browser then received text/html for a module request,
// strict MIME checking rejected it, and every page in production rendered blank.
// Prefer dist/ whenever it has been built; fall back to cwd for `npm run dev`, where Vite
// serves the client itself and this process is API-only.
const distDir = path.join(process.cwd(), 'dist');
const publicDir = fs.existsSync(path.join(distDir, 'index.html')) ? distDir : path.resolve(process.cwd());
const spaShell = path.join(publicDir, 'index.html');
// Fail fast rather than serving a shell that cannot boot. A production image whose
// client build is missing should never reach the healthcheck: better to fail the
// deploy and keep the previous release than to answer 200 with a blank page.
if (config.isProduction && publicDir !== distDir) {
  console.error('[SPR] FATAL: dist/index.html is missing. The client bundle was not built into this image; refusing to serve the source shell.');
  process.exit(1);
}
// Hashed assets are immutable and safe to cache for a year. HTML is not: a year-long
// max-age on index.html would pin a broken deploy into users' browsers.
// redirect:false keeps serve-static from answering a directory request such as /privacy
// with a 301 to /privacy/. Prerendered routes are resolved explicitly below instead, so
// they keep their canonical URLs.
app.use(express.static(publicDir, {
  index: false,
  redirect: false,
  maxAge: config.isProduction ? '1y' : 0,
  setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); },
}));
// Express 5's named wildcard does not match the bare root, so '/' fell through to the
// framework's default 404 ("Cannot GET /") -- the first thing any visitor loaded.
//
// scripts/prerender-public-routes.mjs writes dist/<route>/index.html with per-route title
// and description. Prefer that file when it exists so public pages keep their own metadata
// for crawlers and link unfurls; otherwise fall back to the generic SPA shell and let the
// client router take over. The candidate path is confined to publicDir so a crafted URL
// cannot escape the served directory.
const sendSpaShell = (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/') || req.path === '/mcp') return next();
  const relative = decodeURIComponent(req.path).replace(/^\/+/, '');
  const candidate = path.resolve(publicDir, relative, 'index.html');
  const withinPublicDir = candidate === spaShell || candidate.startsWith(path.resolve(publicDir) + path.sep);
  const file = withinPublicDir && fs.existsSync(candidate) ? candidate : spaShell;
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return res.sendFile(file, error => error ? next(error) : undefined);
};
app.get('/', sendSpaShell);
app.get('/*splat', sendSpaShell);
app.use((req, res, next) => { if (req.path.startsWith('/api/') || req.path === '/mcp') return res.status(404).json({ error: 'Route not found.', code: 'NOT_FOUND', requestId: res.locals.requestId }); return next(); });
app.use((err: any, req: Request, res: Response, next: NextFunction) => { if (res.headersSent) return next(err); const requestId = res.locals.requestId || `req_${randomUUID()}`; const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500; console.error('[HTTP_ERROR]', { requestId, status, method: req.method, path: req.path, message: err?.message || String(err) }); if (config.sentry.dsn) Sentry.captureException(err, { tags: { requestId } }); return res.status(status).json({ error: status === 500 ? 'An unexpected server error occurred.' : err?.message || 'Request failed.', code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED', requestId }); });
export function rejectConnectTunnels(target: ReturnType<typeof app.listen>) { target.on('connect', (_req, socket) => { socket.end('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); }); return target; }
let server: ReturnType<typeof app.listen> | undefined; let shuttingDown = false;
async function shutdown(signal: string) { if (shuttingDown) return; shuttingDown = true; console.info(`[SPR] ${signal} received; shutting down gracefully.`); const forceTimer = setTimeout(() => process.exit(1), 15_000); forceTimer.unref(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await closeDatabase().catch(error => console.error('[SPR] Database shutdown error:', error)); if (config.sentry.dsn) await Sentry.close(2_000).catch(() => undefined); clearTimeout(forceTimer); process.exit(0); }
export async function startServer() { validateConfiguration(); try { await ensureInitialSelfPassport(); } catch (error) { console.error('[SPR] Initial self-passport bootstrap failed; continuing startup. /ready will report the database as unavailable.', error); } const host = process.env.HOST || '0.0.0.0'; server = app.listen(config.port, host, () => console.info(`[SPR] listening on http://${host}:${config.port}`)); rejectConnectTunnels(server); server.requestTimeout = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 120_000; server.headersTimeout = Number.isFinite(requestHeaderTimeoutMs) && requestHeaderTimeoutMs > 0 ? requestHeaderTimeoutMs : 15_000; server.keepAliveTimeout = Number.isFinite(keepAliveTimeoutMs) && keepAliveTimeoutMs > 0 ? keepAliveTimeoutMs : 65_000; return server; }
process.once('SIGTERM', () => void shutdown('SIGTERM')); process.once('SIGINT', () => void shutdown('SIGINT')); process.on('unhandledRejection', reason => console.error('[SPR] Unhandled rejection:', reason)); process.on('uncaughtException', error => { console.error('[SPR] Uncaught exception:', error); void shutdown('uncaughtException'); });
if (process.env.SPR_SKIP_AUTOSTART !== 'true') void startServer().catch(error => { console.error('[SPR] Startup failed:', error); process.exit(1); });
export { app };