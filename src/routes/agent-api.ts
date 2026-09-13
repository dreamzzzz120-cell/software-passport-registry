import { Router } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';
import { attachTenantScope, type ScopedDb } from '../middleware/tenant-scope.ts';
import { evaluateVendorRisk } from '../agents/vendor-risk-agent.ts';

const passportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const softwareInput = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const vendorRiskInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.number().int().min(1).max(3650).optional() }).strict();
const mintInput = z.object({ name: z.string().trim().min(1).max(255), version: z.string().trim().min(1).max(255), publisher: z.string().trim().min(1).max(255), category: z.string().trim().min(1).max(120).default('software'), checksum: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, 'checksum must be a SHA-256 hex digest'), releaseDate: z.string().trim().max(64).optional(), licenseType: z.string().trim().min(1).max(120).default('UNKNOWN'), clientId: z.string().trim().min(1).max(255).nullable().optional() }).strict();
const apiKeyCreateInput = z.object({ name: z.string().trim().min(1).max(120), scopes: z.array(z.enum(['read', 'write', 'webhooks'])).min(1).max(3).refine((v) => new Set(v).size === v.length, 'scopes must be unique'), expiresAt: z.string().trim().max(64).optional() }).strict();

function hashApiKey(key: string) { return createHash('sha256').update(key, 'utf8').digest('hex'); }
function newApiKey() { return `spr_live_${randomBytes(32).toString('base64url')}`; }
function keyPrefix(key: string) { return key.slice(0, 16); }
function hasScope(req: AuthenticatedRequest, scope: 'read' | 'write' | 'webhooks') { const scopes = Array.isArray((req as any).sprApiKeyScopes) ? (req as any).sprApiKeyScopes as string[] : []; return scopes.includes(scope); }

async function requireApiKey(req: AuthenticatedRequest, res: any, next: any) {
  const supplied = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : '';
  if (!/^spr_live_[A-Za-z0-9_-]{20,}$/.test(supplied) || supplied.length > 256) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing or invalid API key.' } });
  try {
    const keyHash = hashApiKey(supplied);
    const row = (await db.execute(sql`SELECT id,tenant_id,scopes,expires_at,revoked_at FROM spr_api_keys WHERE key_hash=${keyHash} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at = '' OR expires_at::timestamptz > CURRENT_TIMESTAMP) LIMIT 1`) as any).rows?.[0];
    if (!row) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing, expired, or revoked API key.' } });
    let scopes: string[]; try { scopes = JSON.parse(String(row.scopes)); } catch { return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'API key configuration is invalid.' } }); }
    if (!Array.isArray(scopes)) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'API key configuration is invalid.' } });
    req.user = { id: 0, uid: `api-key:${row.id}`, email: '', tenantId: String(row.tenant_id), role: 'ApiKey', clientId: null, emailVerified: true };
    req.db = await attachTenantScope(String(row.tenant_id), res);
    (req as any).sprApiKeyId = String(row.id); (req as any).sprApiKeyScopes = scopes;
    await db.execute(sql`UPDATE spr_api_keys SET last_used_at=CURRENT_TIMESTAMP::text WHERE id=${row.id}`);
    return next();
  } catch (error) { return next(error); }
}
function externalAuth(req: AuthenticatedRequest, res: any, next: any) { if (typeof req.headers['x-api-key'] === 'string') return requireApiKey(req, res, next); return requireAuth(req, res, next); }

export function createAgentApiRouter() {
  const router = Router();

  // API-key lifecycle is Firebase-authenticated only. Secrets are returned once.
  router.post('/api-keys', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = apiKeyCreateInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_API_KEY_REQUEST', details: parsed.error.flatten() });
    try {
      const secret = newApiKey(); const id = `key_${randomUUID()}`; const prefix = keyPrefix(secret);
      await req.db!.execute(sql`INSERT INTO spr_api_keys (id,tenant_id,name,key_prefix,key_hash,scopes,expires_at,created_by) VALUES (${id},${req.user!.tenantId},${parsed.data.name},${prefix},${hashApiKey(secret)},${JSON.stringify(parsed.data.scopes)},${parsed.data.expiresAt ?? null},${String(req.user!.id)})`);
      return res.status(201).json({ id, name: parsed.data.name, keyPrefix: prefix, scopes: parsed.data.scopes, expiresAt: parsed.data.expiresAt ?? null, apiKey: secret, warning: 'Store this API key now. SPR cannot recover the secret after this response.' });
    } catch (error) { return next(error); }
  });
  router.get('/api-keys', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try { const rows = (await req.db!.execute(sql`SELECT id,name,key_prefix AS "keyPrefix",scopes,expires_at AS "expiresAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt",created_at AS "createdAt" FROM spr_api_keys WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC`) as any).rows ?? []; return res.json({ keys: rows.map((r: any) => ({ ...r, scopes: JSON.parse(String(r.scopes || '[]')) })) }); } catch (error) { return next(error); }
  });
  router.delete('/api-keys/:keyId', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try { const rows = (await req.db!.execute(sql`UPDATE spr_api_keys SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP::text) WHERE id=${req.params.keyId} AND tenant_id=${req.user!.tenantId} AND revoked_at IS NULL RETURNING id`) as any).rows ?? []; if (!rows.length) return res.status(404).json({ error: 'API_KEY_NOT_FOUND' }); return res.status(204).send(); } catch (error) { return next(error); }
  });

  // External developer surface. Existing Firebase bearer auth remains supported.
  router.use(externalAuth);

  router.get('/openapi.json', (_req, res) => res.json({ openapi: '3.1.0', info: { title: 'Software Passport Registry API', version: '1.0.0', description: 'Evidence-first software verification. UNKNOWN is a valid result; SPR reports observed evidence and does not invent trust.' }, servers: [{ url: '/api/agent/v1' }], security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], components: { securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' }, BearerAuth: { type: 'http', scheme: 'bearer' } } }, paths: { '/passports': { post: { summary: 'Mint/register a passport from observed identity data' } }, '/passports/verify': { post: { summary: 'Verify a passport against current evidence' } }, '/passports/{passportId}': { get: { summary: 'Retrieve a verification snapshot' } }, '/passports/{passportId}/evidence': { get: { summary: 'Retrieve observed evidence' } }, '/passports/{passportId}/freshness': { get: { summary: 'Check observation freshness' } } } }));

  router.post('/passports', async (req: AuthenticatedRequest, res, next) => {
    if ((req as any).sprApiKeyId && !hasScope(req, 'write')) return res.status(403).json({ error: { code: 'API_SCOPE_REQUIRED', message: 'write scope is required.' } });
    const parsed = mintInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT', details: parsed.error.flatten() });
    try {
      const p = parsed.data;
      const existing = (await req.db!.execute(sql`SELECT id,name,version,verification_status AS "verificationStatus",file_hash AS "fileHash" FROM passports WHERE tenant_id=${req.user!.tenantId} AND lower(name)=lower(${p.name}) AND version=${p.version} AND lower(file_hash)=lower(${p.checksum}) LIMIT 1`) as any).rows?.[0];
      if (existing) return res.status(200).json({ created: false, passport: existing, reason: 'IDENTITY_ALREADY_REGISTERED' });
      const id = `pass_${randomUUID()}`;
      await req.db!.execute(sql`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES (${id},${req.user!.tenantId},${p.clientId ?? null},${p.name},${p.version},${p.publisher},${p.category},'unverified',${p.releaseDate ?? new Date().toISOString()},${p.checksum.toLowerCase()},${p.licenseType},'', '[]','[]','[]','[]')`);
      return res.status(201).json({ created: true, passport: { id, name: p.name, version: p.version, publisher: p.publisher, checksum: p.checksum.toLowerCase(), verificationStatus: 'unverified', evidenceBacked: false, trustStatus: 'UNKNOWN' } });
    } catch (error) { return next(error); }
  });

  router.post('/passports/verify', async (req: AuthenticatedRequest, res, next) => {
    const parsed = passportInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT_ID', details: parsed.error.flatten() });
    try { const passport = (await req.db!.execute(sql`SELECT id,name,version,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId }); return buildVerificationResponse(req.db!, req.user!.tenantId, passport, res, next); } catch (error) { return next(error); }
  });
  router.get('/passports/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try { const passport = (await req.db!.execute(sql`SELECT id,name,version,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: req.params.passportId }); return buildVerificationResponse(req.db!, req.user!.tenantId, passport, res, next); } catch (error) { return next(error); }
  });
  router.get('/passports/:passportId/evidence', async (req: AuthenticatedRequest, res, next) => {
    try { const rows = (await req.db!.execute(sql`SELECT id,provider,control_id AS "controlId",subject,source_url AS "sourceUrl",observed_at AS "observedAt",verification_method AS "verificationMethod",status,severity,evidence_hash AS "evidenceHash",limitation FROM evidence_ledger WHERE tenant_id=${req.user!.tenantId} AND passport_id=${req.params.passportId} ORDER BY observed_at DESC LIMIT 500`) as any).rows ?? []; return res.json({ passportId: req.params.passportId, count: rows.length, evidence: rows }); } catch (error) { return next(error); }
  });
  router.get('/passports/:passportId/freshness', async (req: AuthenticatedRequest, res, next) => {
    try { const latest = (await req.db!.execute(sql`SELECT generated_at AS "generatedAt",observation_version AS "observationVersion",canonical_payload_hash AS "canonicalPayloadHash" FROM trust_observations WHERE tenant_id=${req.user!.tenantId} AND passport_id=${req.params.passportId} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0]; if (!latest) return res.json({ passportId: req.params.passportId, status: 'UNKNOWN', reason: 'NO_OBSERVATION' }); const staleAfterDays = Math.min(3650, Math.max(1, Number(req.query.staleAfterDays ?? 30) || 30)); const ageDays = (Date.now() - new Date(latest.generatedAt).getTime()) / 86400000; return res.json({ passportId: req.params.passportId, status: ageDays <= staleAfterDays ? 'CURRENT' : 'STALE', ageDays: Number(ageDays.toFixed(3)), staleAfterDays, generatedAt: latest.generatedAt, observationVersion: latest.observationVersion, canonicalPayloadHash: latest.canonicalPayloadHash }); } catch (error) { return next(error); }
  });

  // Existing agent routes remain available and now accept API keys too.
  router.post('/verify-software', async (req: AuthenticatedRequest, res, next) => {
    const parsed = softwareInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY', details: parsed.error.flatten() });
    try { const db = req.db!; const q = parsed.data.query.toLowerCase(); const passport = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND (LOWER(name)=${q} OR LOWER(id)=${q}) LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', query: parsed.data.query }); return buildVerificationResponse(db, req.user!.tenantId, passport, res, next); } catch (error) { return next(error); }
  });
  router.post('/verify-passport', async (req: AuthenticatedRequest, res, next) => {
    const parsed = passportInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT_ID', details: parsed.error.flatten() });
    try { const db = req.db!; const passport = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId }); return buildVerificationResponse(db, req.user!.tenantId, passport, res, next); } catch (error) { return next(error); }
  });
  router.get('/passport/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try { const db = req.db!; const passport = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: req.params.passportId }); return buildVerificationResponse(db, req.user!.tenantId, passport, res, next); } catch (error) { return next(error); }
  });
  router.post('/vendor-risk', async (req: AuthenticatedRequest, res, next) => {
    const parsed = vendorRiskInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_VENDOR_RISK_REQUEST', details: parsed.error.flatten() });
    try { const db = req.db!; const tenantId = req.user!.tenantId; const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId }); const findings = (await db.execute(sql`SELECT id,severity,status,title,updated_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC LIMIT 200`) as any).rows || []; const evidence = (await db.execute(sql`SELECT id,provider,observed_at,verification_method,status,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 500`) as any).rows || []; const latest = (await db.execute(sql`SELECT generated_at,completeness_basis_points FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0]; return res.json(evaluateVendorRisk({ passport: { id: passport.id, name: passport.name }, findings: findings.map((f: any) => ({ id: String(f.id), severity: String(f.severity || 'unknown'), status: String(f.status || 'unknown'), title: String(f.title || 'Untitled finding'), updatedAt: f.updated_at ? new Date(f.updated_at).toISOString() : null })), evidence: evidence.map((e: any) => ({ id: String(e.id), provider: e.provider == null ? null : String(e.provider), observedAt: e.observed_at ? new Date(e.observed_at).toISOString() : null, verificationMethod: e.verification_method == null ? null : String(e.verification_method), status: e.status == null ? null : String(e.status), limitation: e.limitation == null ? null : String(e.limitation) })), latestObservationAt: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null, completeness: latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000, evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays })); } catch (error) { return next(error); }
  });
  return router;
}

async function buildVerificationResponse(db: ScopedDb, tenantId: string, passport: any, res: any, next: any) {
  try { const findings = (await db.execute(sql`SELECT id,control_id,title,severity,status,description,remediation,evidence_ids,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC`) as any).rows || []; const evidence = (await db.execute(sql`SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 200`) as any).rows || []; const observations = (await db.execute(sql`SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 20`) as any).rows || []; const latest = observations[0]; const openFindings = findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase())); const criticalOrHigh = openFindings.filter((f: any) => ['critical','high'].includes(String(f.severity).toLowerCase())); const completeness = latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000; let status: 'VERIFIED' | 'INVESTIGATE' | 'AVOID' | 'UNKNOWN' = 'UNKNOWN'; if (latest && evidence.length > 0) status = criticalOrHigh.length > 0 ? 'AVOID' : openFindings.length > 0 ? 'INVESTIGATE' : 'VERIFIED'; return res.json({ schemaVersion: 'spr-api-v1', status, software: { passportId: passport.id, name: passport.name, version: passport.version ?? null }, scores: { overall: null, security: null, compliance: null, status: 'not_authoritatively_scored' }, evidence: { count: evidence.length, completeness, latestObservationAt: latest?.generated_at ?? null, latestHash: latest?.canonical_payload_hash ?? null }, findings: { total: findings.length, open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: findings.slice(0, 50) }, verification: { observed: Boolean(latest), evidenceBacked: evidence.length > 0, generatedAt: latest?.generated_at ?? null }, sources: evidence.slice(0, 50).map((e: any) => ({ provider: e.provider, sourceUrl: e.source_url, observedAt: e.observed_at, verificationMethod: e.verification_method, evidenceHash: e.evidence_hash, limitation: e.limitation })), policy: { rule: 'SPR reports observed evidence only; UNKNOWN means insufficient evidence and is not a trust approval.' } }); } catch (error) { return next(error); }
}
