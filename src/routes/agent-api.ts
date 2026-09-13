import { Router } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { attachTenantScope, type ScopedDb } from '../middleware/tenant-scope.ts';
import { evaluateVendorRisk } from '../agents/vendor-risk-agent.ts';

const passportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const softwareInput = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const vendorRiskInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.coerce.number().int().min(1).max(3650).optional() }).strict();
const commandInput = z.object({ input: z.string().trim().min(1).max(500), context: z.object({ path: z.string().max(500).optional() }).optional() }).strict();
const mintInput = z.object({ name: z.string().trim().min(1).max(255), version: z.string().trim().min(1).max(255), publisher: z.string().trim().min(1).max(255), category: z.string().trim().min(1).max(120).default('software'), checksum: z.string().trim().regex(/^[a-fA-F0-9]{64}$/), releaseDate: z.string().trim().min(1).max(64).optional(), licenseType: z.string().trim().min(1).max(120).default('UNKNOWN'), clientId: z.string().trim().min(1).max(255).nullable().optional() }).strict();
const apiKeyCreateInput = z.object({ name: z.string().trim().min(1).max(120), scopes: z.array(z.enum(['read', 'write', 'webhooks'])).min(1).max(3).refine((v) => new Set(v).size === v.length), expiresAt: z.string().trim().min(1).max(64).optional() }).strict();
const MUTATION_INTENT = /\b(delete|remove|purge|drop|wipe|erase|destroy|update|edit|modify|change|override|overwrite|set|mark|flag|resolve|close|reopen|approve|reject|revoke|certify|whitelist|blocklist|ban)\b/;
const hashApiKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');
const newApiKey = () => `spr_live_${randomBytes(32).toString('base64url')}`;
const keyPrefix = (key: string) => key.slice(0, 16);
const hasScope = (req: AuthenticatedRequest, scope: 'read' | 'write' | 'webhooks') => {
  const parsed = z.array(z.enum(['read', 'write', 'webhooks'])).safeParse((req as any).sprApiKeyScopes);
  return parsed.success && parsed.data.includes(scope);
};
const requireScope = (scope: 'read' | 'write' | 'webhooks') => (req: AuthenticatedRequest, res: any, next: any) => {
  if (!(req as any).sprApiKeyId || hasScope(req, scope)) return next();
  return res.status(403).json({ error: { code: 'API_SCOPE_REQUIRED', message: `${scope} scope is required.` } });
};
const futureOrNull = (value: string | undefined) => value == null || (Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now());
const validDate = (value: string | undefined) => value == null || Number.isFinite(Date.parse(value));
const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === '23505';

async function requireApiKey(req: AuthenticatedRequest, res: any, next: any) {
  const supplied = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : '';
  if (!/^spr_live_[A-Za-z0-9_-]{43}$/.test(supplied)) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing or invalid API key.' } });
  try {
    const keyHash = hashApiKey(supplied);
    const row = (await db.execute(sql`SELECT id,tenant_id,scopes FROM spr_api_keys WHERE key_hash=${keyHash} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at = '' OR expires_at::timestamptz > CURRENT_TIMESTAMP) LIMIT 1`) as any).rows?.[0];
    if (!row) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing, expired, or revoked API key.' } });
    let scopes: Array<'read' | 'write' | 'webhooks'>;
    try { scopes = z.array(z.enum(['read', 'write', 'webhooks'])).parse(JSON.parse(String(row.scopes ?? '[]'))); } catch { return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'API key configuration is invalid.' } }); }
    req.user = { id: 0, uid: `api-key:${row.id}`, email: '', tenantId: String(row.tenant_id), role: 'ApiKey', clientId: null, emailVerified: true };
    req.db = await attachTenantScope(String(row.tenant_id), res);
    (req as any).sprApiKeyId = String(row.id);
    (req as any).sprApiKeyScopes = scopes;
    await db.execute(sql`UPDATE spr_api_keys SET last_used_at=CURRENT_TIMESTAMP::text WHERE id=${row.id} AND revoked_at IS NULL`);
    return next();
  } catch (error) { return next(error); }
}
const externalAuth = (req: AuthenticatedRequest, res: any, next: any) => typeof req.headers['x-api-key'] === 'string' ? requireApiKey(req, res, next) : requireAuth(req, res, next);

export function createAgentApiRouter() {
  const router = Router();
  router.post('/command', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    const parsed = commandInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_AGENT_COMMAND', details: parsed.error.flatten() });
    try {
      const q = parsed.data.input.toLowerCase();
      if (/what can you do|help|how do you work/.test(q)) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'help', reply: 'I can summarize observed workspace data, inspect a passport, review vendor risk, and navigate SPR. I do not invent evidence or silently change trust decisions.' });
      if (MUTATION_INTENT.test(q)) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'refused_mutation', reply: 'I can’t do that. The SPR Agent only reports records it can retrieve; it cannot create, change, delete, resolve, or decide trust.' });
      const nav = navigationIntent(q);
      if (nav) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'navigation', ...nav });
      if (/biggest risk|highest risk|most risky|risk today|priority|overview|summary|how are we doing/.test(q)) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'summary', ...(await getRiskSummary(req.db!, req.user!.tenantId)) });
      const match = q.match(/(?:verify|check|assess|inspect|show)\s+(?:the\s+)?(?:passport|software)\s*[:#-]?\s*(.+)$/i);
      if (match?.[1]?.trim()) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'passport', action: { type: 'verify', endpoint: '/api/agent/v1/verify-software', payload: { query: match[1].trim() } } });
      return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'unsupported', reply: 'I do not have a safe wired action for that request yet.' });
    } catch (error) { return next(error); }
  });

  router.post('/api-keys', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = apiKeyCreateInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_API_KEY_REQUEST', details: parsed.error.flatten() });
    if (!futureOrNull(parsed.data.expiresAt)) return res.status(400).json({ error: 'INVALID_API_KEY_REQUEST', details: { expiresAt: 'expiresAt must be a future timestamp.' } });
    try {
      const secret = newApiKey();
      const id = `key_${randomUUID()}`;
      const prefix = keyPrefix(secret);
      await req.db!.execute(sql`INSERT INTO spr_api_keys (id,tenant_id,name,key_prefix,key_hash,scopes,expires_at,created_by) VALUES (${id},${req.user!.tenantId},${parsed.data.name},${prefix},${hashApiKey(secret)},${JSON.stringify(parsed.data.scopes)},${parsed.data.expiresAt ?? null},${String(req.user!.id)})`);
      return res.status(201).json({ id, name: parsed.data.name, keyPrefix: prefix, scopes: parsed.data.scopes, expiresAt: parsed.data.expiresAt ?? null, apiKey: secret });
    } catch (error) { return next(error); }
  });
  router.get('/api-keys', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`SELECT id,name,key_prefix AS "keyPrefix",scopes,expires_at AS "expiresAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt",created_at AS "createdAt" FROM spr_api_keys WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC`) as any).rows ?? [];
      return res.json({ keys: rows.map((r: any) => { let scopes: string[] = []; try { const parsed = z.array(z.enum(['read', 'write', 'webhooks'])).safeParse(JSON.parse(String(r.scopes || '[]'))); if (parsed.success) scopes = parsed.data; } catch { scopes = []; } return { ...r, scopes }; }) });
    } catch (error) { return next(error); }
  });
  router.delete('/api-keys/:keyId', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`UPDATE spr_api_keys SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP::text) WHERE id=${req.params.keyId} AND tenant_id=${req.user!.tenantId} AND revoked_at IS NULL RETURNING id`) as any).rows ?? [];
      if (!rows.length) return res.status(404).json({ error: 'API_KEY_NOT_FOUND' });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  router.use(externalAuth);
  router.get('/openapi.json', (_req, res) => res.json({ openapi: '3.1.0', info: { title: 'Software Passport Registry API', version: '1.0.0' }, servers: [{ url: '/api/agent/v1' }], security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], components: { securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' }, BearerAuth: { type: 'http', scheme: 'bearer' } } } }));
  router.post('/passports', requireScope('write'), async (req: AuthenticatedRequest, res, next) => {
    const parsed = mintInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT', details: parsed.error.flatten() });
    if (!validDate(parsed.data.releaseDate)) return res.status(400).json({ error: 'INVALID_PASSPORT', details: { releaseDate: 'releaseDate must be a valid timestamp.' } });
    try {
      const p = parsed.data;
      if (p.clientId) {
        const client = (await req.db!.execute(sql`SELECT id FROM clients WHERE tenant_id=${req.user!.tenantId} AND id=${p.clientId} LIMIT 1`) as any).rows?.[0];
        if (!client) return res.status(400).json({ error: { code: 'CLIENT_NOT_FOUND', message: 'clientId must belong to the authenticated tenant.' } });
      }
      const existing = (await req.db!.execute(sql`SELECT id,name,version,verification_status AS "verificationStatus",file_hash AS "fileHash" FROM passports WHERE tenant_id=${req.user!.tenantId} AND lower(name)=lower(${p.name}) AND version=${p.version} AND lower(file_hash)=lower(${p.checksum}) LIMIT 1`) as any).rows?.[0];
      if (existing) return res.status(200).json({ created: false, passport: existing, reason: 'IDENTITY_ALREADY_REGISTERED' });
      const id = `pass_${randomUUID()}`;
      await req.db!.execute(sql`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES (${id},${req.user!.tenantId},${p.clientId ?? null},${p.name},${p.version},${p.publisher},${p.category},'unverified',${p.releaseDate ?? new Date().toISOString()},${p.checksum.toLowerCase()},${p.licenseType},'', '[]','[]','[]','[]')`);
      return res.status(201).json({ created: true, passport: { id, name: p.name, version: p.version, publisher: p.publisher, checksum: p.checksum.toLowerCase(), verificationStatus: 'unverified', evidenceBacked: false, trustStatus: 'UNKNOWN' } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = (await req.db!.execute(sql`SELECT id,name,version,verification_status AS "verificationStatus",file_hash AS "fileHash" FROM passports WHERE tenant_id=${req.user!.tenantId} AND lower(name)=lower(${parsed.data.name}) AND version=${parsed.data.version} AND lower(file_hash)=lower(${parsed.data.checksum}) LIMIT 1`) as any).rows?.[0];
        if (existing) return res.status(200).json({ created: false, passport: existing, reason: 'IDENTITY_ALREADY_REGISTERED' });
      }
      return next(error);
    }
  });

  const verify = async (req: AuthenticatedRequest, res: any, next: any) => {
    const parsed = passportInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT_ID', details: parsed.error.flatten() });
    try {
      const passport = (await req.db!.execute(sql`SELECT id,name,version FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      return buildVerificationResponse(req.db!, req.user!.tenantId, passport, res, next);
    } catch (error) { return next(error); }
  };
  router.post('/passports/verify', requireScope('read'), verify);
  router.post('/verify-software', requireScope('read'), async (req: AuthenticatedRequest, res, next) => {
    const parsed = softwareInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY', details: parsed.error.flatten() });
    try {
      const query = parsed.data.query.toLowerCase();
      const passport = (await req.db!.execute(sql`SELECT id,name,version FROM passports WHERE tenant_id=${req.user!.tenantId} AND (LOWER(name)=${query} OR LOWER(id)=${query}) LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', query: parsed.data.query });
      return buildVerificationResponse(req.db!, req.user!.tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });
  router.get('/passports/:passportId', requireScope('read'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const passport = (await req.db!.execute(sql`SELECT id,name,version FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: req.params.passportId });
      return buildVerificationResponse(req.db!, req.user!.tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });
  router.get('/passports/:passportId/evidence', requireScope('read'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const passport = (await req.db!.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passport not found.' } });
      const rows = (await req.db!.execute(sql`SELECT id,provider,control_id AS "controlId",subject,source_url AS "sourceUrl",observed_at AS "observedAt",verification_method AS "verificationMethod",status,severity,evidence_hash AS "evidenceHash",limitation FROM evidence_ledger WHERE tenant_id=${req.user!.tenantId} AND passport_id=${req.params.passportId} ORDER BY observed_at DESC LIMIT 500`) as any).rows ?? [];
      return res.json({ passportId: req.params.passportId, count: rows.length, evidence: rows });
    } catch (error) { return next(error); }
  });
  router.get('/passports/:passportId/freshness', requireScope('read'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const passport = (await req.db!.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passport not found.' } });
      const latest = (await req.db!.execute(sql`SELECT generated_at AS "generatedAt",observation_version AS "observationVersion",canonical_payload_hash AS "canonicalPayloadHash" FROM trust_observations WHERE tenant_id=${req.user!.tenantId} AND passport_id=${req.params.passportId} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0];
      if (!latest) return res.json({ passportId: req.params.passportId, status: 'UNKNOWN', reason: 'NO_OBSERVATION' });
      const staleAfterDays = Math.min(3650, Math.max(1, Number(req.query.staleAfterDays ?? 30) || 30));
      const ageDays = (Date.now() - new Date(latest.generatedAt).getTime()) / 86400000;
      return res.json({ passportId: req.params.passportId, status: ageDays <= staleAfterDays ? 'CURRENT' : 'STALE', ageDays: Number(ageDays.toFixed(3)), staleAfterDays, generatedAt: latest.generatedAt, observationVersion: latest.observationVersion, canonicalPayloadHash: latest.canonicalPayloadHash });
    } catch (error) { return next(error); }
  });
  router.post('/vendor-risk', requireScope('read'), async (req: AuthenticatedRequest, res, next) => {
    const parsed = vendorRiskInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_VENDOR_RISK_REQUEST', details: parsed.error.flatten() });
    try {
      const passport = (await req.db!.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      const findings = (await req.db!.execute(sql`SELECT id,severity,status,title,updated_at FROM trust_findings WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY updated_at DESC LIMIT 200`) as any).rows || [];
      const evidence = (await req.db!.execute(sql`SELECT id,provider,observed_at,verification_method,status,limitation FROM evidence_ledger WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 500`) as any).rows || [];
      const latest = (await req.db!.execute(sql`SELECT generated_at,completeness_basis_points FROM trust_observations WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0];
      return res.json(evaluateVendorRisk({ passport: { id: passport.id, name: passport.name }, findings: findings.map((f: any) => ({ id: String(f.id), severity: String(f.severity || 'unknown'), status: String(f.status || 'unknown'), title: String(f.title || 'Untitled finding'), updatedAt: f.updated_at ? new Date(f.updated_at).toISOString() : null })), evidence: evidence.map((e: any) => ({ id: String(e.id), provider: e.provider == null ? null : String(e.provider), observedAt: e.observed_at ? new Date(e.observed_at).toISOString() : null, verificationMethod: e.verification_method == null ? null : String(e.verification_method), status: e.status == null ? null : String(e.status), limitation: e.limitation == null ? null : String(e.limitation) })), latestObservationAt: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null, completeness: latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000, evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays }));
    } catch (error) { return next(error); }
  });
  return router;
}

function navigationIntent(q: string): { path: string; reply: string } | null {
  const routes: Array<[RegExp, string, string]> = [[/command center|dashboard|home/, '/dashboard', 'Opening the Command Center.'], [/clients?|customer list|client management/, '/clients', 'Opening Clients.'], [/passports?|registry|software inventory/, '/passports', 'Opening Passports.'], [/vendors?|third.?party risk/, '/vendors', 'Opening Vendor Risk.'], [/monitoring|alerts?/, '/monitoring', 'Opening Monitoring.'], [/compliance|governance/, '/compliance', 'Opening Compliance.'], [/reports?/, '/reports', 'Opening Reports.'], [/billing|subscription|plan/, '/billing', 'Opening Billing.'], [/settings?/, '/settings', 'Opening Settings.']];
  for (const [pattern, path, reply] of routes) if (pattern.test(q)) return { path, reply };
  return null;
}

async function getRiskSummary(scopedDb: ScopedDb, tenantId: string) {
  const [clients, passports, findings, alerts] = await Promise.all([
    scopedDb.execute(sql`SELECT COUNT(*)::int AS count FROM clients WHERE tenant_id=${tenantId}`),
    scopedDb.execute(sql`SELECT COUNT(*)::int AS count FROM passports WHERE tenant_id=${tenantId}`),
    scopedDb.execute(sql`SELECT COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('resolved','closed','verified'))::int AS open, COUNT(*) FILTER (WHERE LOWER(severity) IN ('critical','high') AND LOWER(status) NOT IN ('resolved','closed','verified'))::int AS critical_high FROM trust_findings WHERE tenant_id=${tenantId}`),
    scopedDb.execute(sql`SELECT COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('resolved','closed'))::int AS active FROM alerts WHERE tenant_id=${tenantId}`),
  ]);
  const c = (clients as any).rows?.[0]?.count ?? 0;
  const p = (passports as any).rows?.[0]?.count ?? 0;
  const f = (findings as any).rows?.[0] ?? {};
  const a = (alerts as any).rows?.[0]?.active ?? 0;
  return { reply: `I found ${c} client(s), ${p} passport(s), ${f.open ?? 0} open finding(s), ${f.critical_high ?? 0} critical/high open finding(s), and ${a} active alert(s). These are database observations, not invented estimates.`, data: { counts: { clients: c, passports: p, openFindings: f.open ?? 0, criticalHighFindings: f.critical_high ?? 0, activeAlerts: a } }, provenance: { generatedAt: new Date().toISOString(), tenantScoped: true } };
}

async function buildVerificationResponse(scopedDb: ScopedDb, tenantId: string, passport: any, res: any, next: any) {
  try {
    const findings = (await scopedDb.execute(sql`SELECT id,control_id,title,severity,status,description,remediation,evidence_ids,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY updated_at DESC`) as any).rows || [];
    const evidence = (await scopedDb.execute(sql`SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 200`) as any).rows || [];
    const observations = (await scopedDb.execute(sql`SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 20`) as any).rows || [];
    const latest = observations[0];
    const openFindings = findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase()));
    const criticalOrHigh = openFindings.filter((f: any) => ['critical','high'].includes(String(f.severity).toLowerCase()));
    const completeness = latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000;
    return res.json({ schemaVersion: 'spr-api-v1', status: latest || evidence.length || findings.length ? 'OBSERVED' : 'UNKNOWN', software: { passportId: passport.id, name: passport.name, version: passport.version ?? null }, scores: { overall: null, security: null, compliance: null, status: 'not_authoritatively_scored' }, evidence: { count: evidence.length, completeness, latestObservationAt: latest?.generated_at ?? null, latestHash: latest?.canonical_payload_hash ?? null }, findings: { total: findings.length, open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: findings.slice(0, 50) }, verification: { observed: Boolean(latest), evidenceBacked: evidence.length > 0, generatedAt: latest?.generated_at ?? null }, sources: evidence.slice(0, 50).map((e: any) => ({ provider: e.provider, sourceUrl: e.source_url, observedAt: e.observed_at, verificationMethod: e.verification_method, evidenceHash: e.evidence_hash, limitation: e.limitation })), policy: { rule: 'SPR reports observed evidence only; UNKNOWN means insufficient evidence and is not a trust approval.' } });
  } catch (error) { return next(error); }
}
