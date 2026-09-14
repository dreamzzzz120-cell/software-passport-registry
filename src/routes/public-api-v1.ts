import { Router } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { db } from '../db/index.ts';

const scopes = z.enum(['read', 'write', 'webhooks']);
const keyCreate = z.object({ name: z.string().trim().min(1).max(120), scopes: z.array(scopes).min(1).max(3).refine(v => new Set(v).size === v.length), expiresAt: z.string().trim().min(1).max(64).optional() }).strict();
const passportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const softwareInput = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const mintInput = z.object({ name: z.string().trim().min(1).max(255), version: z.string().trim().min(1).max(255), publisher: z.string().trim().min(1).max(255), category: z.string().trim().min(1).max(120).default('software'), checksum: z.string().trim().regex(/^[a-fA-F0-9]{64}$/), releaseDate: z.string().trim().min(1).max(64).optional(), licenseType: z.string().trim().min(1).max(120).default('UNKNOWN'), clientId: z.string().trim().min(1).max(255).nullable().optional() }).strict();

const hashKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');
const newKey = () => `spr_live_${randomBytes(32).toString('base64url')}`;
const future = (value?: string) => value == null || (Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now());

async function apiKeyAuth(req: AuthenticatedRequest, res: any, next: any) {
  const supplied = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : '';
  if (!/^spr_live_[A-Za-z0-9_-]{43}$/.test(supplied)) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing or invalid API key.' } });
  try {
    const keyHash = hashKey(supplied);
    const row = (await db.execute(sql`SELECT id,tenant_id,scopes FROM spr_api_keys WHERE key_hash=${keyHash} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at = '' OR expires_at::timestamptz > CURRENT_TIMESTAMP) LIMIT 1`) as any).rows?.[0];
    if (!row) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Missing, expired, or revoked API key.' } });
    const parsedScopes = z.array(scopes).safeParse(JSON.parse(String(row.scopes ?? '[]')));
    if (!parsedScopes.success) return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'API key configuration is invalid.' } });
    req.user = { id: 0, uid: `api-key:${row.id}`, email: '', tenantId: String(row.tenant_id), role: 'ApiKey', clientId: null, emailVerified: true };
    req.db = await attachTenantScope(String(row.tenant_id), res);
    (req as any).sprApiKeyId = String(row.id); (req as any).sprApiKeyScopes = parsedScopes.data;
    await db.execute(sql`UPDATE spr_api_keys SET last_used_at=CURRENT_TIMESTAMP::text WHERE id=${row.id} AND revoked_at IS NULL`);
    next();
  } catch (error) { next(error); }
}

function scope(scopeName: z.infer<typeof scopes>) { return (req: AuthenticatedRequest, res: any, next: any) => { if ((req as any).sprApiKeyScopes?.includes(scopeName)) return next(); return res.status(403).json({ error: { code: 'API_SCOPE_REQUIRED', message: `${scopeName} scope is required.` } }); }; }

export function createPublicApiV1Router() {
  const router = Router();
  const publicApi = Router();
  publicApi.use(apiKeyAuth);
  publicApi.get('/openapi.json', (_req, res) => res.json({ openapi: '3.1.0', info: { title: 'Software Passport Registry API', version: '1.0.0', description: 'Evidence-first software verification. UNKNOWN is valid and never represents approval.' }, servers: [{ url: '/api/agent/v1' }], security: [{ ApiKeyAuth: [] }], components: { securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } }, paths: { '/passports': { post: {}, }, '/passports/verify': { post: {} }, '/passports/{passportId}': { get: {} }, '/passports/{passportId}/evidence': { get: {} }, '/passports/{passportId}/freshness': { get: {} }, '/verify-software': { post: {} } } }));

  publicApi.post('/passports', scope('write'), async (req: AuthenticatedRequest, res, next) => {
    const parsed = mintInput.safeParse(req.body);
    if (!parsed.success || !future(parsed.success ? parsed.data.releaseDate : undefined)) return res.status(400).json({ error: 'INVALID_PASSPORT', details: parsed.success ? { releaseDate: 'releaseDate must be a valid date when supplied.' } : parsed.error.flatten() });
    try {
      const p = parsed.data;
      if (p.clientId) { const client = (await req.db!.execute(sql`SELECT id FROM clients WHERE tenant_id=${req.user!.tenantId} AND id=${p.clientId} LIMIT 1`) as any).rows?.[0]; if (!client) return res.status(400).json({ error: { code: 'CLIENT_NOT_FOUND', message: 'clientId must belong to the authenticated tenant.' } }); }
      const existing = (await req.db!.execute(sql`SELECT id,name,version,verification_status AS "verificationStatus",file_hash AS "fileHash" FROM passports WHERE tenant_id=${req.user!.tenantId} AND lower(name)=lower(${p.name}) AND version=${p.version} AND lower(file_hash)=lower(${p.checksum}) LIMIT 1`) as any).rows?.[0];
      if (existing) return res.status(200).json({ created: false, passport: existing, reason: 'IDENTITY_ALREADY_REGISTERED' });
      const id = `pass_${randomUUID()}`;
      await req.db!.execute(sql`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES (${id},${req.user!.tenantId},${p.clientId ?? null},${p.name},${p.version},${p.publisher},${p.category},'unverified',${p.releaseDate ?? new Date().toISOString()},${p.checksum.toLowerCase()},${p.licenseType},'', '[]','[]','[]','[]')`);
      return res.status(201).json({ created: true, passport: { id, name: p.name, version: p.version, publisher: p.publisher, checksum: p.checksum.toLowerCase(), verificationStatus: 'unverified', evidenceBacked: false, trustStatus: 'UNKNOWN' } });
    } catch (error) { next(error); }
  });

  publicApi.post('/passports/verify', scope('read'), verifyPassport);
  publicApi.get('/passports/:passportId', scope('read'), verifyPassport);
  publicApi.post('/verify-software', scope('read'), async (req: AuthenticatedRequest, res, next) => {
    const parsed = softwareInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY', details: parsed.error.flatten() });
    try { const q = parsed.data.query.toLowerCase(); const passport = (await req.db!.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${req.user!.tenantId} AND (LOWER(name)=${q} OR LOWER(id)=${q}) LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', query: parsed.data.query }); return verification(req, res, next, passport); } catch (error) { next(error); }
  });
  publicApi.get('/passports/:passportId/evidence', scope('read'), async (req: AuthenticatedRequest, res, next) => {
    try { const passport = (await req.db!.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: req.params.passportId }); const rows = (await req.db!.execute(sql`SELECT id,provider,control_id AS "controlId",subject,source_url AS "sourceUrl",observed_at AS "observedAt",verification_method AS "verificationMethod",status,severity,evidence_hash AS "evidenceHash",limitation FROM evidence_ledger WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 500`) as any).rows ?? []; return res.json({ passportId: passport.id, count: rows.length, evidence: rows }); } catch (error) { next(error); }
  });
  publicApi.get('/passports/:passportId/freshness', scope('read'), async (req: AuthenticatedRequest, res, next) => {
    try { const passport = (await req.db!.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: req.params.passportId }); const latest = (await req.db!.execute(sql`SELECT generated_at AS "generatedAt",observation_version AS "observationVersion",canonical_payload_hash AS "canonicalPayloadHash" FROM trust_observations WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0]; if (!latest) return res.json({ passportId: passport.id, status: 'UNKNOWN', reason: 'NO_OBSERVATION' }); const staleAfterDays = Math.min(3650, Math.max(1, Number(req.query.staleAfterDays ?? 30) || 30)); const ageDays = (Date.now() - new Date(latest.generatedAt).getTime()) / 86400000; return res.json({ passportId: passport.id, status: ageDays <= staleAfterDays ? 'CURRENT' : 'STALE', ageDays: Number(ageDays.toFixed(3)), staleAfterDays, generatedAt: latest.generatedAt, observationVersion: latest.observationVersion, canonicalPayloadHash: latest.canonicalPayloadHash }); } catch (error) { next(error); }
  });
  publicApi.post('/vendor-risk', scope('read'), async (req: AuthenticatedRequest, res, next) => { try { const passportId = String(req.body?.passportId ?? ''); if (!passportId) return res.status(400).json({ error: 'INVALID_VENDOR_RISK_REQUEST' }); const passport = (await req.db!.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId }); const findings = (await req.db!.execute(sql`SELECT id,severity,status,title,updated_at FROM trust_findings WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY updated_at DESC LIMIT 200`) as any).rows ?? []; return res.json({ status: findings.length ? 'OBSERVED' : 'UNKNOWN', passport, findings, provenance: { tenantScoped: true, findingIds: findings.map((f: any) => String(f.id)) } }); } catch (error) { next(error); } });

  router.use(publicApi);
  router.use(requireAuth);
  router.post('/api-keys', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => { const parsed = keyCreate.safeParse(req.body); if (!parsed.success || !future(parsed.success ? parsed.data.expiresAt : undefined)) return res.status(400).json({ error: 'INVALID_API_KEY_REQUEST', details: parsed.success ? { expiresAt: 'expiresAt must be a future timestamp.' } : parsed.error.flatten() }); try { const secret = newKey(); const id = `key_${randomUUID()}`; const prefix = secret.slice(0, 16); await req.db!.execute(sql`INSERT INTO spr_api_keys (id,tenant_id,name,key_prefix,key_hash,scopes,expires_at,created_by) VALUES (${id},${req.user!.tenantId},${parsed.data.name},${prefix},${hashKey(secret)},${JSON.stringify(parsed.data.scopes)},${parsed.data.expiresAt ?? null},${String(req.user!.id)})`); return res.status(201).json({ id, name: parsed.data.name, keyPrefix: prefix, scopes: parsed.data.scopes, expiresAt: parsed.data.expiresAt ?? null, apiKey: secret, warning: 'Store this API key now. SPR cannot recover the secret after this response.' }); } catch (error) { next(error); } });
  router.get('/api-keys', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => { try { const rows = (await req.db!.execute(sql`SELECT id,name,key_prefix AS "keyPrefix",scopes,expires_at AS "expiresAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt",created_at AS "createdAt" FROM spr_api_keys WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC`) as any).rows ?? []; return res.json({ keys: rows }); } catch (error) { next(error); } });
  router.delete('/api-keys/:keyId', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => { try { const rows = (await req.db!.execute(sql`UPDATE spr_api_keys SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP::text) WHERE id=${req.params.keyId} AND tenant_id=${req.user!.tenantId} AND revoked_at IS NULL RETURNING id`) as any).rows ?? []; if (!rows.length) return res.status(404).json({ error: 'API_KEY_NOT_FOUND' }); return res.status(204).send(); } catch (error) { next(error); } });
  return router;
}

async function verifyPassport(req: AuthenticatedRequest, res: any, next: any) { try { const passport = (await req.db!.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${req.body?.passportId ?? req.params.passportId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: req.body?.passportId ?? req.params.passportId }); return verification(req, res, next, passport); } catch (error) { next(error); } }

async function verification(req: AuthenticatedRequest, res: any, next: any, passport: any) { try { const findings = (await req.db!.execute(sql`SELECT id,control_id AS "controlId",title,severity,status,description,remediation,evidence_ids AS "evidenceIds",updated_at AS "updatedAt",resolved_at AS "resolvedAt" FROM trust_findings WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY updated_at DESC`) as any).rows ?? []; const evidence = (await req.db!.execute(sql`SELECT id,provider,control_id AS "controlId",subject,source_url AS "sourceUrl",observed_at AS "observedAt",verification_method AS "verificationMethod",status,severity,evidence_hash AS "evidenceHash",limitation FROM evidence_ledger WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 200`) as any).rows ?? []; const latest = (await req.db!.execute(sql`SELECT observation_version AS "observationVersion",generated_at AS "generatedAt",canonical_payload_hash AS "canonicalPayloadHash",completeness_basis_points AS "completenessBasisPoints",unknown_dimension_count AS "unknownDimensionCount" FROM trust_observations WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0]; const observed = Boolean(latest || evidence.length || findings.length); return res.json({ schemaVersion: 'spr-api-v1', status: observed ? 'OBSERVED' : 'UNKNOWN', software: { passportId: passport.id, name: passport.name }, trustDecision: { status: 'NOT_CREATED_BY_PUBLIC_API', reason: 'Public API reports observed SPR records and does not manufacture or duplicate trust decisions.' }, evidence: { count: evidence.length, latestObservationAt: latest?.generatedAt ?? null, latestHash: latest?.canonicalPayloadHash ?? null, completeness: latest?.completenessBasisPoints == null ? null : Number(latest.completenessBasisPoints) / 10000 }, findings: { total: findings.length, open: findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase())).length, items: findings.slice(0, 50) }, verification: { evidenceBacked: evidence.length > 0, observed }, provenance: { tenantScoped: true, passportId: passport.id, evidenceIds: evidence.map((e: any) => String(e.id)), findingIds: findings.map((f: any) => String(f.id)), observationVersion: latest?.observationVersion ?? null } }); } catch (error) { next(error); } }
