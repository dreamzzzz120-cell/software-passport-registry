import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const assignSchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  technicianUserId: z.number().int().positive().optional(),
  technicianDisplay: z.string().trim().min(1).max(255),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

export function createMspRouter() {
  const router = Router();

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

  // MSP commercial usage is measured in Active Passports: unique passports
  // with enabled continuous integration monitoring. This deliberately excludes
  // one-off scans and historical/inactive passports from the billable meter.
  router.get('/usage', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const subscription = (await db.execute(sql`SELECT plan, status, client_limit AS "activePassportLimit" FROM tenant_subscriptions WHERE tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0] ?? null;
      const usage = (await db.execute(sql`SELECT COUNT(DISTINCT passport_id)::int AS "activePassports" FROM monitoring_configurations WHERE tenant_id=${tenantId} AND subject_type='integration_provider' AND enabled=true`) as any).rows?.[0];
      const activePassports = Number(usage?.activePassports ?? 0);
      const limit = subscription?.activePassportLimit == null ? null : Number(subscription.activePassportLimit);
      return res.json({
        billingUnit: 'active_passport',
        definition: 'Unique passport with at least one enabled integration-monitoring configuration.',
        plan: subscription?.plan ?? null,
        subscriptionStatus: subscription?.status ?? 'none',
        activePassports,
        includedActivePassports: limit,
        remaining: limit == null ? null : Math.max(0, limit - activePassports),
        overLimit: limit != null && activePassports > limit,
      });
    } catch (error) { return next(error); }
  });

  return router;
}
