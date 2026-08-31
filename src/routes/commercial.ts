import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { PLAN_CAPABILITY_MATRIX, enforceCapability } from '../security/entitlements.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const router = Router();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

router.get('/entitlements', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const subscription = (await req.db!.execute(sql`SELECT plan, status, current_period_end AS "currentPeriodEnd" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0] ?? null;
    const capabilities = subscription?.plan ? PLAN_CAPABILITY_MATRIX[subscription.plan] ?? [] : [];
    res.json({ plan: subscription?.plan ?? null, status: subscription?.status ?? 'none', currentPeriodEnd: subscription?.currentPeriodEnd ?? null, capabilities, matrix: PLAN_CAPABILITY_MATRIX });
  } catch (error) { next(error); }
});

router.get('/exports/:resource', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!(await enforceCapability(req, res, 'bulk_export'))) return;
    const resource = String(req.params.resource);
    const tenantId = req.user!.tenantId;
    const allowed: Record<string, string> = {
      clients: 'SELECT id, name, domain, industry, trust_score, risk_level, subscription_tier, joined_date, team_count, passport_count, critical_risks_count, compliance_progress FROM clients WHERE tenant_id = $1 ORDER BY name',
      passports: 'SELECT id, client_id, name, version, publisher, category, overall_score, security_score, compliance_score, vendor_reputation_score, confidence_score, evidence_completeness, verification_status, release_date, file_hash, license_type FROM passports WHERE tenant_id = $1 ORDER BY name',
      alerts: 'SELECT id, title, severity, category, client_name, status, timestamp, passport_id, client_id, asset_id FROM alerts WHERE tenant_id = $1 ORDER BY timestamp DESC',
      vendors: 'SELECT id, name, risk_level, status, created_at, updated_at FROM vendors WHERE tenant_id = $1 ORDER BY name',
    };
    if (!allowed[resource]) return res.status(404).json({ error: 'EXPORT_RESOURCE_NOT_FOUND' });
    const result = await req.db!.execute(sql.raw(allowed[resource].replace('$1', `'${tenantId.replaceAll("'", "''")}'`)));
    const rows = (result as any).rows ?? [];
    const format = req.query.format === 'json' ? 'json' : 'csv';
    await appendAuditEntry(req.db!, { tenantId, action: 'export.completed', actor: req.user!.uid, payload: { resource, rowCount: rows.length, format } });
    if (format === 'json') return res.json({ resource, exportedAt: new Date().toISOString(), rows });
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [columns.map(esc).join(','), ...rows.map((row: any) => columns.map(column => esc(row[column])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="spr-${resource}-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(csv);
  } catch (error) { next(error); }
});

const deletionSchema = z.object({ confirmation: z.literal('DELETE MY WORKSPACE') }).strict();
router.post('/tenant/deletion-request', requireAuth, requireRole(['Owner']), async (req: AuthenticatedRequest, res, next) => {
  const parsed = deletionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'DELETE_CONFIRMATION_REQUIRED' });
  try {
    const tenantId = req.user!.tenantId;
    const requestId = id('tenant_delete');
    await req.db!.execute(sql`INSERT INTO tenant_deletion_requests (id, tenant_id, requested_by) VALUES (${requestId}, ${tenantId}, ${req.user!.uid})`);
    await appendAuditEntry(req.db!, { tenantId, action: 'tenant.deletion.requested', actor: req.user!.uid, payload: { requestId } });
    res.status(202).json({ requestId, status: 'PENDING', message: 'Workspace deletion has been queued. Immutable audit/evidence records remain protected by the evidence retention policy.' });
  } catch (error) { next(error); }
});

const retentionSchema = z.object({ auditDays: z.number().int().min(30).max(3650).optional(), evidenceDays: z.number().int().min(30).max(3650).optional(), notificationDays: z.number().int().min(30).max(3650).optional() }).strict();
router.get('/retention', requireAuth, requireRole(['Owner','Admin']), async (req: AuthenticatedRequest, res, next) => {
  try {
    const row = (await req.db!.execute(sql`SELECT tenant_id AS "tenantId", audit_days AS "auditDays", evidence_days AS "evidenceDays", notification_days AS "notificationDays", updated_at AS "updatedAt" FROM retention_policies WHERE tenant_id = ${req.user!.tenantId}`) as any).rows?.[0] ?? null;
    res.json(row);
  } catch (error) { next(error); }
});
router.put('/retention', requireAuth, requireRole(['Owner','Admin']), async (req: AuthenticatedRequest, res, next) => {
  const parsed = retentionSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
  try {
    const p = parsed.data; const tenantId = req.user!.tenantId;
    const row = (await req.db!.execute(sql`
      INSERT INTO retention_policies (tenant_id, audit_days, evidence_days, notification_days, updated_by)
      VALUES (${tenantId}, ${p.auditDays ?? 2555}, ${p.evidenceDays ?? 730}, ${p.notificationDays ?? 180}, ${req.user!.uid})
      ON CONFLICT (tenant_id) DO UPDATE SET audit_days = COALESCE(${p.auditDays ?? null}, retention_policies.audit_days), evidence_days = COALESCE(${p.evidenceDays ?? null}, retention_policies.evidence_days), notification_days = COALESCE(${p.notificationDays ?? null}, retention_policies.notification_days), updated_by = ${req.user!.uid}, updated_at = CURRENT_TIMESTAMP
      RETURNING tenant_id AS "tenantId", audit_days AS "auditDays", evidence_days AS "evidenceDays", notification_days AS "notificationDays", updated_at AS "updatedAt"
    `) as any).rows?.[0];
    await appendAuditEntry(req.db!, { tenantId, action: 'retention.policy.updated', actor: req.user!.uid, payload: row });
    res.json(row);
  } catch (error) { next(error); }
});

const notificationSchema = z.object({ channel: z.enum(['email','sms']), destination: z.string().trim().min(3).max(320), subject: z.string().trim().max(255).optional(), body: z.string().trim().min(1).max(10000) }).strict();
router.post('/notifications', requireAuth, requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
  const parsed = notificationSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
  try {
    const p = parsed.data; const tenantId = req.user!.tenantId; const notificationId = id('notification');
    await req.db!.execute(sql`INSERT INTO notification_outbox (id, tenant_id, channel, destination, subject, body) VALUES (${notificationId}, ${tenantId}, ${p.channel}, ${p.destination}, ${p.subject ?? null}, ${p.body})`);
    await appendAuditEntry(req.db!, { tenantId, action: 'notification.queued', actor: req.user!.uid, payload: { notificationId, channel: p.channel } });
    res.status(202).json({ id: notificationId, status: 'PENDING' });
  } catch (error) { next(error); }
});

export function createCommercialRouter() { return router; }
