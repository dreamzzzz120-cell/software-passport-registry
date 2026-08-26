import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';
import { buildAndPersistReport } from './trust-loop.ts';

const createSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  frequency: z.enum(['Daily', 'Weekly', 'Monthly']),
  targetEmail: z.string().trim().email().max(320),
}).strict();
const updateSchema = z.object({ status: z.enum(['Active', 'Paused']) }).strict();

const SELECT_COLUMNS = sql`id, tenant_id AS "tenantId", client_id AS "clientId", frequency, target_email AS "targetEmail", status, last_audit_at AS "lastAuditAt", next_audit_at AS "nextAuditAt", created_at AS "createdAt"`;

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

function nextAuditAt(frequency: string, from = new Date()) {
  const next = new Date(from);
  if (frequency === 'Weekly') next.setDate(next.getDate() + 7);
  else if (frequency === 'Monthly') next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function createComplianceRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/schedules', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`SELECT ${SELECT_COLUMNS} FROM compliance_schedules WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC`);
      return res.json((result as any).rows || []);
    } catch (error) { return next(error); }
  });

  router.post('/schedules', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const { clientId, frequency, targetEmail } = parsed.data;
      const client = (await db.execute(sql`SELECT id FROM clients WHERE id=${clientId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!client) return res.status(404).json({ error: 'Client not found' });
      const now = new Date();
      const scheduleId = id('cschedule');
      const createdAt = now.toISOString();
      const next = nextAuditAt(frequency, now);
      await db.execute(sql`INSERT INTO compliance_schedules (id,tenant_id,client_id,frequency,target_email,status,last_audit_at,next_audit_at,created_by,created_at) VALUES (${scheduleId},${tenantId},${clientId},${frequency},${targetEmail},'Active',NULL,${next},${req.user!.email},${createdAt})`);
      const row = (await db.execute(sql`SELECT ${SELECT_COLUMNS} FROM compliance_schedules WHERE id=${scheduleId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      return res.status(201).json(row);
    } catch (error) { return next(error); }
  });

  router.put('/schedules/:id', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const db = req.db!;
      const result = await db.execute(sql`UPDATE compliance_schedules SET status=${parsed.data.status} WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'Compliance schedule not found' });
      const row = (await db.execute(sql`SELECT ${SELECT_COLUMNS} FROM compliance_schedules WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} LIMIT 1`) as any).rows?.[0];
      return res.json(row);
    } catch (error) { return next(error); }
  });

  router.delete('/schedules/:id', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`DELETE FROM compliance_schedules WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'Compliance schedule not found' });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  // Manual trigger only: there is no scheduler in this codebase (the closest
  // analog, scan_schedules.next_run_at, is display-only and nothing polls
  // it) and no email/SMTP integration exists to notify target_email. This
  // generates a real evidence-backed compliance report (via the same
  // pipeline GET /api/trust-loop/reports/:passportId uses) for every
  // passport the client has, and says so honestly in the response message
  // rather than claiming anything was scheduled or emailed.
  router.post('/schedules/:id/run', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const schedule = (await db.execute(sql`SELECT ${SELECT_COLUMNS} FROM compliance_schedules WHERE id=${req.params.id} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!schedule) return res.status(404).json({ error: 'Compliance schedule not found' });
      if (schedule.status !== 'Active') return res.status(409).json({ error: 'Compliance schedule is paused' });
      const passports = (await db.execute(sql`SELECT id FROM passports WHERE tenant_id=${tenantId} AND client_id=${schedule.clientId}`) as any).rows || [];
      if (!passports.length) return res.status(422).json({ error: 'No software passports are registered for this client; there is nothing to generate a compliance report from.' });
      const reports: Array<{ passportId: string; reportHash: string }> = [];
      for (const passport of passports) {
        const report = await buildAndPersistReport(db, tenantId, passport.id, 'compliance');
        if (report) reports.push({ passportId: passport.id, reportHash: report.reportHash });
      }
      const now = new Date();
      const next = nextAuditAt(schedule.frequency, now);
      await db.execute(sql`UPDATE compliance_schedules SET last_audit_at=${now.toISOString()}, next_audit_at=${next} WHERE id=${req.params.id} AND tenant_id=${tenantId}`);
      const updated = (await db.execute(sql`SELECT ${SELECT_COLUMNS} FROM compliance_schedules WHERE id=${req.params.id} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      return res.status(202).json({
        schedule: updated,
        reports,
        message: `Compliance report generated for ${reports.length} of ${passports.length} passport(s). No email was sent to ${schedule.targetEmail} — no email delivery is configured in this deployment.`,
      });
    } catch (error) { return next(error); }
  });

  return router;
}
