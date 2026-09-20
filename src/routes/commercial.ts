import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const router = Router();

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

export function createCommercialRouter() { return router; }
