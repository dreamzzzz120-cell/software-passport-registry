import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const DATA_CLASSIFICATIONS = ['unclassified', 'internal', 'confidential', 'regulated'] as const;
const STATUSES = ['active', 'under_review', 'deprecated', 'blocked'] as const;
const OBSERVATION_TYPES = ['security', 'privacy', 'access_change', 'model_change', 'vendor_assessment', 'other'] as const;

const createSystemSchema = z.object({
  name: z.string().trim().min(1).max(255),
  vendor: z.string().trim().min(1).max(255),
  model: z.string().trim().min(1).max(255),
  version: z.string().trim().max(120).default('unspecified'),
  purpose: z.string().trim().max(2000).default(''),
  dataClassification: z.enum(DATA_CLASSIFICATIONS).default('unclassified'),
  status: z.enum(STATUSES).default('under_review'),
  toolAccess: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  permissions: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  ownerDisplay: z.string().trim().max(255).default(''),
}).strict();
const updateSystemSchema = createSystemSchema.partial().strict();
const observationSchema = z.object({
  observationType: z.enum(OBSERVATION_TYPES),
  summary: z.string().trim().min(1).max(500),
  detail: z.string().trim().max(4000).default(''),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function parseJson<T>(value: unknown, fallback: T): T { try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }

export function createAiTrustRouter() {
  const router = Router();

  // This is a self-reported registry, not an auto-discovered inventory: SPR has
  // no mechanism to detect AI usage on its own, so every field here is what the
  // tenant declared, and every UI surface for it must say so rather than imply
  // authoritative observation the way passport evidence does.
  router.get('/systems', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const rows = ((await db.execute(sql`SELECT * FROM ai_systems WHERE tenant_id=${req.user!.tenantId} ORDER BY updated_at DESC`) as any).rows || []).map((row: any) => ({ ...row, tool_access: parseJson(row.tool_access, []), permissions: parseJson(row.permissions, []) }));
      return res.json({ systems: rows });
    } catch (error) { return next(error); }
  });

  router.post('/systems', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = createSystemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const now = new Date().toISOString();
      const systemId = id('aisys');
      const p = parsed.data;
      await db.execute(sql`
        INSERT INTO ai_systems (id, tenant_id, name, vendor, model, version, purpose, data_classification, status, tool_access, permissions, owner_display, created_by, created_at, updated_at)
        VALUES (${systemId}, ${tenantId}, ${p.name}, ${p.vendor}, ${p.model}, ${p.version}, ${p.purpose}, ${p.dataClassification}, ${p.status}, ${JSON.stringify(p.toolAccess)}, ${JSON.stringify(p.permissions)}, ${p.ownerDisplay}, ${req.user!.email}, ${now}, ${now})
      `);
      await appendAuditEntry(db, { tenantId, action: 'ai_system.registered', actor: req.user!.email, payload: { systemId, name: p.name, vendor: p.vendor } });
      return res.status(201).json({ id: systemId, ...p });
    } catch (error) { return next(error); }
  });

  router.patch('/systems/:id', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = updateSystemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const existing = (await db.execute(sql`SELECT * FROM ai_systems WHERE id=${req.params.id} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!existing) return res.status(404).json({ error: 'AI_SYSTEM_NOT_FOUND' });
      const p = parsed.data;
      const now = new Date().toISOString();
      const row = (await db.execute(sql`
        UPDATE ai_systems SET
          name=COALESCE(${p.name ?? null}, name), vendor=COALESCE(${p.vendor ?? null}, vendor), model=COALESCE(${p.model ?? null}, model),
          version=COALESCE(${p.version ?? null}, version), purpose=COALESCE(${p.purpose ?? null}, purpose),
          data_classification=COALESCE(${p.dataClassification ?? null}, data_classification), status=COALESCE(${p.status ?? null}, status),
          tool_access=COALESCE(${p.toolAccess ? JSON.stringify(p.toolAccess) : null}, tool_access), permissions=COALESCE(${p.permissions ? JSON.stringify(p.permissions) : null}, permissions),
          owner_display=COALESCE(${p.ownerDisplay ?? null}, owner_display), updated_at=${now}
        WHERE id=${req.params.id} AND tenant_id=${tenantId} RETURNING *
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'ai_system.updated', actor: req.user!.email, payload: { systemId: req.params.id, changes: p } });
      return res.json({ ...row, tool_access: parseJson(row.tool_access, []), permissions: parseJson(row.permissions, []) });
    } catch (error) { return next(error); }
  });

  router.delete('/systems/:id', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`DELETE FROM ai_systems WHERE id=${req.params.id} AND tenant_id=${tenantId} RETURNING id, name`);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'AI_SYSTEM_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'ai_system.removed', actor: req.user!.email, payload: { systemId: row.id, name: row.name } });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  router.get('/systems/:id/observations', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const owner = (await db.execute(sql`SELECT id FROM ai_systems WHERE id=${req.params.id} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!owner) return res.status(404).json({ error: 'AI_SYSTEM_NOT_FOUND' });
      const rows = await db.execute(sql`SELECT * FROM ai_system_observations WHERE tenant_id=${tenantId} AND ai_system_id=${req.params.id} ORDER BY created_at DESC`);
      return res.json({ observations: (rows as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.post('/systems/:id/observations', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = observationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const owner = (await db.execute(sql`SELECT id FROM ai_systems WHERE id=${req.params.id} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!owner) return res.status(404).json({ error: 'AI_SYSTEM_NOT_FOUND' });
      const observationId = id('aiobs');
      const now = new Date().toISOString();
      const p = parsed.data;
      await db.execute(sql`INSERT INTO ai_system_observations (id, tenant_id, ai_system_id, observation_type, summary, detail, observed_by, created_at) VALUES (${observationId}, ${tenantId}, ${req.params.id}, ${p.observationType}, ${p.summary}, ${p.detail}, ${req.user!.email}, ${now})`);
      await appendAuditEntry(db, { tenantId, action: 'ai_system.observation_logged', actor: req.user!.email, payload: { systemId: req.params.id, observationType: p.observationType } });
      return res.status(201).json({ id: observationId, aiSystemId: req.params.id, ...p, observedBy: req.user!.email, createdAt: now });
    } catch (error) { return next(error); }
  });

  return router;
}
