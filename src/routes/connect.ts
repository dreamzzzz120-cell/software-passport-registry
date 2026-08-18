import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { requireAuth, AuthenticatedRequest } from '../middleware/security.ts';

const API_VERSION = '2026-08-01';
const PUBLIC_SCOPES = ['read', 'write', 'webhooks'] as const;
const DEFAULT_EVENTS = [
  'passport.updated',
  'trust.changed',
  'risk.created',
  'risk.resolved',
  'evidence.updated',
  'verification.completed',
  'verification.expired',
] as const;

const createKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(PUBLIC_SCOPES)).min(1).max(3).default(['read']),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

const registerSoftwareSchema = z.object({
  name: z.string().min(1).max(200),
  version: z.string().max(100).default('unknown'),
  publisher: z.string().max(200).default('unknown'),
  category: z.string().max(120).default('software'),
  sourceType: z.enum(['repository', 'application', 'package', 'container', 'api', 'saas', 'other']).default('application'),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  licenseType: z.string().max(120).default('unobserved'),
  releaseDate: z.string().max(40).default('unobserved'),
  metadata: z.record(z.unknown()).default({}),
}).strict();

const webhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.string().min(1).max(100)).min(1).max(50).default([...DEFAULT_EVENTS]),
}).strict();

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createSecret(prefix: string) {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function parseJson<T = unknown>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function bearer(req: any) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice(7).trim();
}

async function authenticateApiKey(req: any, res: any, next: any) {
  const raw = bearer(req);
  if (!raw) return res.status(401).json({ error: 'Missing Bearer API key' });
  const keyHash = hash(raw);
  const rows = await db.execute(sql`
    SELECT id, tenant_id, name, scopes, expires_at, revoked_at
    FROM spr_api_keys
    WHERE key_hash = ${keyHash}
    LIMIT 1
  `);
  const row: any = (rows as any).rows?.[0];
  if (!row) return res.status(401).json({ error: 'Invalid API key' });
  if (row.revoked_at) return res.status(401).json({ error: 'API key revoked' });
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return res.status(401).json({ error: 'API key expired' });
  }
  const scopes = parseJson<string[]>(row.scopes, ['read']);
  req.sprApi = { id: row.id, tenantId: row.tenant_id, name: row.name, scopes };
  await db.execute(sql`UPDATE spr_api_keys SET last_used_at = ${new Date().toISOString()} WHERE id = ${row.id}`);
  next();
}

function requireScope(scope: string) {
  return (req: any, res: any, next: any) => {
    if (!req.sprApi?.scopes?.includes(scope)) return res.status(403).json({ error: `Scope required: ${scope}` });
    next();
  };
}

async function tenantPassport(tenantId: string, passportId: string) {
  const result = await db.execute(sql`
    SELECT id, tenant_id, client_id, name, version, publisher, category,
           overall_score, security_score, compliance_score, vendor_reputation_score,
           release_date, file_hash, license_type, ai_summary, sbom, evidence, vulnerabilities, timeline
    FROM passports
    WHERE id = ${passportId} AND tenant_id = ${tenantId}
    LIMIT 1
  `);
  return (result as any).rows?.[0] || null;
}

function publicPassport(row: any) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    publisher: row.publisher,
    category: row.category,
    scores: {
      overall: row.overall_score,
      security: row.security_score,
      compliance: row.compliance_score,
      reputation: row.vendor_reputation_score,
    },
    releaseDate: row.release_date,
    licenseType: row.license_type,
    summary: row.ai_summary,
    evidenceCount: parseJson<any[]>(row.evidence, []).length,
    vulnerabilityCount: parseJson<any[]>(row.vulnerabilities, []).length,
    sbomComponentCount: parseJson<any[]>(row.sbom, []).length,
  };
}

export function createConnectRouter() {
  const router = Router();

  router.get('/v1', (_req, res) => {
    res.json({
      name: 'SPR Connect API',
      version: API_VERSION,
      status: 'operational',
      capabilities: ['software', 'passports', 'trust', 'evidence', 'risk', 'history', 'webhooks'],
      authentication: 'Bearer API key',
    });
  });

  // API-key management uses the user's existing authenticated SPR session.
  router.post('/v1/api-keys', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    const raw = createSecret('spr_live');
    const keyId = id('key');
    await db.execute(sql`
      INSERT INTO spr_api_keys (id, tenant_id, name, key_prefix, key_hash, scopes, expires_at, created_by)
      VALUES (${keyId}, ${req.user!.tenantId}, ${parsed.data.name}, ${raw.slice(0, 16)}, ${hash(raw)}, ${JSON.stringify(parsed.data.scopes)}, ${parsed.data.expiresAt ?? null}, ${req.user!.uid})
    `);
    res.status(201).json({
      id: keyId,
      name: parsed.data.name,
      key: raw,
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expiresAt ?? null,
      warning: 'Store this key now. SPR will not return the full secret again.',
    });
  });

  router.get('/v1/api-keys', requireAuth, async (req: AuthenticatedRequest, res) => {
    const result = await db.execute(sql`
      SELECT id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
      FROM spr_api_keys WHERE tenant_id = ${req.user!.tenantId} ORDER BY created_at DESC
    `);
    res.json((result as any).rows?.map((r: any) => ({
      id: r.id, name: r.name, keyPrefix: r.key_prefix, scopes: parseJson(r.scopes, ['read']),
      lastUsedAt: r.last_used_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at,
    })) ?? []);
  });

  router.delete('/v1/api-keys/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const result = await db.execute(sql`
      UPDATE spr_api_keys SET revoked_at = ${new Date().toISOString()}
      WHERE id = ${req.params.id} AND tenant_id = ${req.user!.tenantId} AND revoked_at IS NULL
      RETURNING id
    `);
    if (!((result as any).rows?.length)) return res.status(404).json({ error: 'API key not found' });
    res.status(204).send();
  });

  router.post('/v1/software', authenticateApiKey, requireScope('write'), async (req, res) => {
    const parsed = registerSoftwareSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    const data = parsed.data;
    if (data.externalId) {
      const existing = await db.execute(sql`SELECT id, passport_id FROM spr_assets WHERE tenant_id = ${req.sprApi.tenantId} AND external_id = ${data.externalId} LIMIT 1`);
      const found: any = (existing as any).rows?.[0];
      if (found) return res.json({ id: found.id, passportId: found.passport_id, existing: true });
    }
    const passportId = id('passport');
    const assetId = id('asset');
    const now = new Date().toISOString();
    await db.execute(sql`
      INSERT INTO passports (id, tenant_id, name, version, publisher, category, overall_score, security_score, compliance_score, vendor_reputation_score, release_date, file_hash, license_type, ai_summary, sbom, evidence, vulnerabilities, timeline)
      VALUES (${passportId}, ${req.sprApi.tenantId}, ${data.name}, ${data.version}, ${data.publisher}, ${data.category}, 0, 0, 0, 0, ${data.releaseDate}, 'unobserved', ${data.licenseType}, '', '[]', '[]', '[]', ${JSON.stringify([{ date: now, event: 'Passport Registered', user: 'SPR Connect', details: `Registered through ${data.sourceType}` }])})
    `);
    await db.execute(sql`
      INSERT INTO spr_assets (id, tenant_id, passport_id, external_id, name, source_type, source_url, version, publisher, metadata, created_at, updated_at)
      VALUES (${assetId}, ${req.sprApi.tenantId}, ${passportId}, ${data.externalId ?? null}, ${data.name}, ${data.sourceType}, ${data.sourceUrl ?? null}, ${data.version}, ${data.publisher}, ${JSON.stringify(data.metadata)}, ${now}, ${now})
    `);
    res.status(201).json({ id: assetId, passportId, status: 'registered', observed: { name: true, version: data.version !== 'unknown', publisher: data.publisher !== 'unknown', source: Boolean(data.sourceUrl) } });
  });

  router.get('/v1/software/:id', authenticateApiKey, async (req, res) => {
    const result = await db.execute(sql`
      SELECT id, passport_id, external_id, name, source_type, source_url, version, publisher, metadata, created_at, updated_at
      FROM spr_assets WHERE id = ${req.params.id} AND tenant_id = ${req.sprApi.tenantId} LIMIT 1
    `);
    const asset: any = (result as any).rows?.[0];
    if (!asset) return res.status(404).json({ error: 'Software asset not found' });
    const passport = await tenantPassport(req.sprApi.tenantId, asset.passport_id);
    res.json({
      id: asset.id, passportId: asset.passport_id, externalId: asset.external_id, name: asset.name,
      source: { type: asset.source_type, url: asset.source_url }, version: asset.version, publisher: asset.publisher,
      metadata: parseJson(asset.metadata, {}), passport: passport ? publicPassport(passport) : null,
    });
  });

  router.get('/v1/passports/:id', authenticateApiKey, async (req, res) => {
    const passport = await tenantPassport(req.sprApi.tenantId, req.params.id);
    if (!passport) return res.status(404).json({ error: 'Passport not found' });
    res.json(publicPassport(passport));
  });

  router.get('/v1/passports/:id/trust', authenticateApiKey, async (req, res) => {
    const passport = await tenantPassport(req.sprApi.tenantId, req.params.id);
    if (!passport) return res.status(404).json({ error: 'Passport not found' });
    const result = await db.execute(sql`
      SELECT id, observation_version, generated_at, completeness_basis_points, known_dimension_count, unknown_dimension_count, stale_dimension_count, expired_dimension_count, immutable_payload
      FROM trust_observations WHERE tenant_id = ${req.sprApi.tenantId} AND passport_id = ${req.params.id}
      ORDER BY observation_version DESC LIMIT 1
    `);
    const obs: any = (result as any).rows?.[0];
    const payload = obs ? parseJson<any>(obs.immutable_payload, {}) : {};
    res.json({
      passportId: req.params.id,
      score: passport.overall_score,
      dimensions: payload.dimensions ?? payload.scores ?? null,
      evidenceCoverage: obs ? obs.completeness_basis_points / 100 : null,
      observation: obs ? { id: obs.id, version: obs.observation_version, generatedAt: obs.generated_at, known: obs.known_dimension_count, unknown: obs.unknown_dimension_count, stale: obs.stale_dimension_count, expired: obs.expired_dimension_count } : null,
      note: obs ? undefined : 'No trust observation is currently available; score fields are not evidence of verification.',
    });
  });

  router.get('/v1/passports/:id/evidence', authenticateApiKey, async (req, res) => {
    const passport = await tenantPassport(req.sprApi.tenantId, req.params.id);
    if (!passport) return res.status(404).json({ error: 'Passport not found' });
    res.json({ passportId: req.params.id, evidence: parseJson(passport.evidence, []) });
  });

  router.get('/v1/passports/:id/risks', authenticateApiKey, async (req, res) => {
    const passport = await tenantPassport(req.sprApi.tenantId, req.params.id);
    if (!passport) return res.status(404).json({ error: 'Passport not found' });
    const result = await db.execute(sql`
      SELECT id, title, severity, category, description, status, timestamp, observation_id, evidence_ids, finding_ids
      FROM alerts WHERE tenant_id = ${req.sprApi.tenantId} AND passport_id = ${req.params.id}
      ORDER BY timestamp DESC
    `);
    res.json((result as any).rows?.map((r: any) => ({ ...r, evidenceIds: parseJson(r.evidence_ids, []), findingIds: parseJson(r.finding_ids, []) })) ?? []);
  });

  router.get('/v1/passports/:id/history', authenticateApiKey, async (req, res) => {
    const passport = await tenantPassport(req.sprApi.tenantId, req.params.id);
    if (!passport) return res.status(404).json({ error: 'Passport not found' });
    const result = await db.execute(sql`
      SELECT id, observation_version, generated_at, previous_observation_id, canonical_payload_hash, generation_reason
      FROM trust_observations WHERE tenant_id = ${req.sprApi.tenantId} AND passport_id = ${req.params.id}
      ORDER BY observation_version DESC
    `);
    res.json((result as any).rows ?? []);
  });

  router.post('/v1/webhooks', authenticateApiKey, requireScope('webhooks'), async (req, res) => {
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    const secret = createSecret('whsec');
    const webhookId = id('wh');
    await db.execute(sql`
      INSERT INTO spr_webhooks (id, tenant_id, url, secret_hash, events)
      VALUES (${webhookId}, ${req.sprApi.tenantId}, ${parsed.data.url}, ${hash(secret)}, ${JSON.stringify(parsed.data.events)})
    `);
    res.status(201).json({ id: webhookId, url: parsed.data.url, events: parsed.data.events, secret, warning: 'Store this signing secret now. SPR will not return it again.' });
  });

  router.get('/v1/webhooks', authenticateApiKey, requireScope('webhooks'), async (req, res) => {
    const result = await db.execute(sql`
      SELECT id, url, events, enabled, created_at, updated_at FROM spr_webhooks WHERE tenant_id = ${req.sprApi.tenantId} ORDER BY created_at DESC
    `);
    res.json((result as any).rows?.map((r: any) => ({ id: r.id, url: r.url, events: parseJson(r.events, [...DEFAULT_EVENTS]), enabled: Boolean(r.enabled), createdAt: r.created_at, updatedAt: r.updated_at })) ?? []);
  });

  router.delete('/v1/webhooks/:id', authenticateApiKey, requireScope('webhooks'), async (req, res) => {
    const result = await db.execute(sql`DELETE FROM spr_webhooks WHERE id = ${req.params.id} AND tenant_id = ${req.sprApi.tenantId} RETURNING id`);
    if (!((result as any).rows?.length)) return res.status(404).json({ error: 'Webhook not found' });
    res.status(204).send();
  });

  return router;
}
