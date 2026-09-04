import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'node:crypto';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';

const roles = ['Owner', 'Admin'];
const createSchema = z.object({
  passportId: z.string().trim().min(1).max(255),
  reportType: z.string().trim().min(1).max(64).default('executive'),
  cadence: z.enum(['weekly','monthly']),
  recipientEmails: z.array(z.string().trim().email().max(320)).min(1).max(25),
}).strict();
const patchSchema = z.object({ enabled: z.boolean() }).strict();
const id = () => `rptsch_${crypto.randomUUID().replaceAll('-','')}`;
function json(row: any) { return { id: row.id, passportId: row.passport_id, reportType: row.report_type, cadence: row.cadence, recipientEmails: JSON.parse(row.recipient_emails || '[]'), nextRunAt: row.next_run_at, enabled: row.enabled, lastRunAt: row.last_run_at, lastError: row.last_error }; }
function nextRun(cadence: 'weekly'|'monthly') { const d = new Date(); if (cadence === 'weekly') d.setUTCDate(d.getUTCDate()+7); else d.setUTCMonth(d.getUTCMonth()+1); return d.toISOString(); }

export function createReportSchedulesRouter() {
  const router = Router();
  router.get('/', async (req: AuthenticatedRequest, res, next) => { try { const rows = (await req.db!.execute(sql`SELECT * FROM report_schedules WHERE tenant_id = ${req.user!.tenantId} ORDER BY created_at DESC`) as any).rows || []; return res.json(rows.map(json)); } catch (e) { return next(e); } });
  router.post('/', requireRole(roles), async (req: AuthenticatedRequest, res, next) => {
    const p = createSchema.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: p.error.flatten() });
    try {
      const db=req.db!, tenant=req.user!.tenantId;
      const passport=(await db.execute(sql`SELECT id FROM passports WHERE id=${p.data.passportId} AND tenant_id=${tenant} LIMIT 1`) as any).rows?.[0];
      if(!passport) return res.status(404).json({error:'PASSPORT_NOT_FOUND'});
      const scheduleId=id(), emails=JSON.stringify([...new Set(p.data.recipientEmails.map(e=>e.toLowerCase()))]), now=new Date().toISOString(), next=nextRun(p.data.cadence);
      await db.execute(sql`INSERT INTO report_schedules (id,tenant_id,passport_id,report_type,cadence,recipient_emails,next_run_at,enabled,created_by,created_at,updated_at) VALUES (${scheduleId},${tenant},${p.data.passportId},${p.data.reportType},${p.data.cadence},${emails},${next},true,${req.user!.uid},${now},${now})`);
      const row=(await db.execute(sql`SELECT * FROM report_schedules WHERE id=${scheduleId} AND tenant_id=${tenant}`) as any).rows?.[0]; return res.status(201).json(json(row));
    } catch(e){return next(e);}
  });
  router.patch('/:id', requireRole(roles), async(req:AuthenticatedRequest,res,next)=>{const p=patchSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'INVALID_PAYLOAD'});try{const row=(await req.db!.execute(sql`UPDATE report_schedules SET enabled=${p.data.enabled}, updated_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING *`) as any).rows?.[0];if(!row)return res.status(404).json({error:'SCHEDULE_NOT_FOUND'});return res.json(json(row));}catch(e){return next(e);}});
  router.delete('/:id', requireRole(roles), async(req:AuthenticatedRequest,res,next)=>{try{const result=await req.db!.execute(sql`DELETE FROM report_schedules WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId}`) as any;if(!result.rowCount)return res.status(404).json({error:'SCHEDULE_NOT_FOUND'});return res.status(204).end();}catch(e){return next(e);}});
  return router;
}
