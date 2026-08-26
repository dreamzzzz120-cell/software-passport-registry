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

  // Cross-client assignment list: who is responsible for which client. Every
  // metric this feeds (workload per technician, unassigned clients) is a
  // direct read of this table, not an inferred rollup.
  router.get('/assignments', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const rows = await db.execute(sql`SELECT id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at FROM client_assignments WHERE tenant_id=${req.user!.tenantId} ORDER BY updated_at DESC`);
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

  return router;
}
