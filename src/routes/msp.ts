import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';
import { encryptCredential } from '../security/credential-vault.ts';
import { validateWebhookUrl } from '../security/webhook-url.ts';

const assignSchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  technicianUserId: z.number().int().positive().optional(),
  technicianDisplay: z.string().trim().min(1).max(255),
}).strict();

const WEBHOOK_EVENTS = ['passport.updated', 'trust.changed', 'risk.created', 'risk.resolved', 'evidence.updated', 'verification.completed', 'verification.expired'] as const;
const webhookCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
}).strict();
const webhookPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().trim().url().max(2048).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
  active: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required');

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function webhookSecret() { return `sprwh_${crypto.randomBytes(32).toString('base64url')}`; }
function normalizeEvents(events: readonly string[]) { return [...new Set(events)].sort(); }

export function createMspRouter() {
  const router = Router();

  // Cross-client assignment list for MSP staff. Client principals must only
  // receive assignments belonging to their authenticated client boundary.
  router.get('/assignments', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const isClient = req.user!.role === 'Client';
      const clientId = req.user!.clientId;
      if (isClient && !clientId) return res.status(403).json({ error: 'Client account has invalid client configuration' });
      const rows = await db.execute(sql`SELECT id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at FROM client_assignments WHERE tenant_id=${tenantId} AND (${isClient ? sql`client_id = ${clientId}` : sql`TRUE`}) ORDER BY updated_at DESC`);
      return res.json({ assignments: (rows as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.put('/assignments', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const client = (await db.execute(sql`SELECT id FROM clients WHERE id=${parsed.data.clientId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
      const now = new Date().toISOString();
      const row = (await db.execute(sql`
        INSERT INTO client_assignments (id, tenant_id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at)
        VALUES (${id('assign')}, ${tenantId}, ${parsed.data.clientId}, ${parsed.data.technicianUserId ?? null}, ${parsed.data.technicianDisplay}, ${req.user!.email}, ${now}, ${now})
        ON CONFLICT (tenant_id, client_id) DO UPDATE SET technician_user_id=EXCLUDED.technician_user_id, technician_display=EXCLUDED.technician_display, assigned_by=EXCLUDED.assigned_by, updated_at=EXCLUDED.updated_at
        RETURNING id, client_id, technician_display
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'client.technician_assigned', actor: req.user!.email, payload: { clientId: parsed.data.clientId, technicianDisplay: parsed.data.technicianDisplay } });
      return res.status(200).json(row);
    } catch (error) { return next(error); }
  });

  router.delete('/assignments/:clientId', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`DELETE FROM client_assignments WHERE tenant_id=${tenantId} AND client_id=${req.params.clientId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'ASSIGNMENT_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'client.technician_unassigned', actor: req.user!.email, payload: { clientId: req.params.clientId } });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  // Active Passport billing is based on unique passports with at least one
  // enabled integration-monitoring configuration. This is the billable unit:
  // scans and historical passports do not consume the allowance.
  router.get('/usage', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const subscription = (await db.execute(sql`SELECT plan, status, client_limit AS "activePassportLimit" FROM tenant_subscriptions WHERE tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0] ?? null;
      const usage = (await db.execute(sql`SELECT COUNT(DISTINCT passport_id)::int AS "activePassports" FROM monitoring_configurations WHERE tenant_id=${tenantId} AND subject_type='integration_provider' AND enabled=true`) as any).rows?.[0];
      const activePassports = Number(usage?.activePassports ?? 0);
      const limit = subscription?.activePassportLimit == null ? null : Number(subscription.activePassportLimit);
      return res.json({
        billingUnit: 'active_passport',
        definition: 'A unique passport with at least one enabled integration-monitoring configuration.',
        plan: subscription?.plan ?? null,
        subscriptionStatus: subscription?.status ?? 'none',
        activePassports,
        includedActivePassports: limit,
        remaining: limit == null ? null : Math.max(0, limit - activePassports),
        overLimit: limit != null && activePassports > limit,
      });
    } catch (error) { return next(error); }
  });

  router.get('/webhooks', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await req.db!.execute(sql`SELECT id,name,url,events,active,consecutive_failure_count AS "consecutiveFailureCount",disabled_at AS "disabledAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM spr_webhooks WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC`);
      return res.json({ webhooks: ((rows as any).rows ?? []).map((row: any) => ({ ...row, events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events })) });
    } catch (error) { return next(error); }
  });

  router.post('/webhooks', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = webhookCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const url = await validateWebhookUrl(parsed.data.url);
      const secret = webhookSecret();
      const encrypted = encryptCredential(secret, tenantId, 'webhook');
      const webhookId = id('wh');
      const events = JSON.stringify(normalizeEvents(parsed.data.events));
      const now = new Date().toISOString();
      await db.execute(sql`INSERT INTO spr_webhooks (id,tenant_id,name,url,events,secret_ciphertext,secret_key_version,active,consecutive_failure_count,created_by,created_at,updated_at) VALUES (${webhookId},${tenantId},${parsed.data.name},${url.toString()},${events},${encrypted.ciphertext},${encrypted.keyVersion},true,0,${req.user!.uid},${now},${now})`);
      await appendAuditEntry(db, { tenantId, action: 'msp.webhook_created', actor: req.user!.uid, payload: { webhookId, events: parsed.data.events, destinationHost: url.hostname } });
      return res.status(201).json({ id: webhookId, name: parsed.data.name, url: url.toString(), events: JSON.parse(events), active: true, secret, secretWarning: 'Store this signing secret now. SPR will not return it again.' });
    } catch (error: any) {
      if (/WEBHOOK|publicly routable|HTTPS/.test(error?.message || '')) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.patch('/webhooks/:id', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = webhookPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      if (parsed.data.url) await validateWebhookUrl(parsed.data.url);
      const name = parsed.data.name ?? null;
      const url = parsed.data.url ?? null;
      const events = parsed.data.events ? JSON.stringify(normalizeEvents(parsed.data.events)) : null;
      const active = parsed.data.active ?? null;
      const row = (await db.execute(sql`UPDATE spr_webhooks SET name=COALESCE(${name},name),url=COALESCE(${url},url),events=COALESCE(${events},events),active=COALESCE(${active},active),disabled_at=CASE WHEN ${active}=false THEN CURRENT_TIMESTAMP WHEN ${active}=true THEN NULL ELSE disabled_at END,consecutive_failure_count=CASE WHEN ${active}=true THEN 0 ELSE consecutive_failure_count END,updated_at=CURRENT_TIMESTAMP WHERE id=${req.params.id} AND tenant_id=${tenantId} RETURNING id,name,url,events,active,consecutive_failure_count AS "consecutiveFailureCount",disabled_at AS "disabledAt",updated_at AS "updatedAt"`) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'WEBHOOK_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'msp.webhook_updated', actor: req.user!.uid, payload: { webhookId: req.params.id, active: parsed.data.active ?? undefined, changedFields: Object.keys(parsed.data) } });
      return res.json({ ...row, events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events });
    } catch (error: any) {
      if (/WEBHOOK|publicly routable|HTTPS/.test(error?.message || '')) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/webhooks/:id/rotate-secret', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const secret = webhookSecret();
      const encrypted = encryptCredential(secret, tenantId, 'webhook');
      const row = (await db.execute(sql`UPDATE spr_webhooks SET secret_ciphertext=${encrypted.ciphertext},secret_key_version=${encrypted.keyVersion},consecutive_failure_count=0,active=true,disabled_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${req.params.id} AND tenant_id=${tenantId} RETURNING id,name,url,events,active`) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'WEBHOOK_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'msp.webhook_secret_rotated', actor: req.user!.uid, payload: { webhookId: req.params.id } });
      return res.json({ id: row.id, name: row.name, url: row.url, events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events, active: row.active, secret, secretWarning: 'Store this signing secret now. SPR will not return it again.' });
    } catch (error) { return next(error); }
  });

  router.post('/webhooks/:id/test', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const webhook = (await db.execute(sql`SELECT id,url,active FROM spr_webhooks WHERE id=${req.params.id} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!webhook) return res.status(404).json({ error: 'WEBHOOK_NOT_FOUND' });
      if (!webhook.active) return res.status(409).json({ error: 'WEBHOOK_INACTIVE' });
      const eventId = id('evt');
      const now = new Date().toISOString();
      const deliveryId = id('whdelivery');
      await db.execute(sql`INSERT INTO spr_webhook_deliveries (id,tenant_id,webhook_id,event_id,event_type,payload,idempotency_key,attempt_number,status,next_attempt_at,created_at) VALUES (${deliveryId},${tenantId},${webhook.id},${eventId},'verification.completed',${JSON.stringify({test:true,source:'SPR',message:'Webhook connectivity test'})},${crypto.createHash('sha256').update(`${tenantId}:${webhook.id}:${eventId}`).digest('hex')},1,'queued',${now},${now}) ON CONFLICT (tenant_id,webhook_id,idempotency_key) DO NOTHING`);
      await appendAuditEntry(db, { tenantId, action: 'msp.webhook_test_queued', actor: req.user!.uid, payload: { webhookId: webhook.id, deliveryId } });
      return res.status(202).json({ deliveryId, eventId, status: 'queued' });
    } catch (error) { return next(error); }
  });

  router.get('/webhooks/:id/deliveries', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await req.db!.execute(sql`SELECT id,event_id,event_type,status,attempt_number AS "attemptNumber",next_attempt_at AS "nextAttemptAt",response_status AS "responseStatus",response_ms AS "responseMs",safe_error_code AS "errorCode",safe_error_message AS "errorMessage",created_at AS "createdAt",completed_at AS "completedAt" FROM spr_webhook_deliveries WHERE tenant_id=${req.user!.tenantId} AND webhook_id=${req.params.id} ORDER BY created_at DESC LIMIT 100`);
      return res.json({ deliveries: (rows as any).rows ?? [] });
    } catch (error) { return next(error); }
  });

  router.delete('/webhooks/:id', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await req.db!.execute(sql`DELETE FROM spr_webhooks WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'WEBHOOK_NOT_FOUND' });
      await appendAuditEntry(req.db!, { tenantId: req.user!.tenantId, action: 'msp.webhook_deleted', actor: req.user!.uid, payload: { webhookId: req.params.id } });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  return router;
}
