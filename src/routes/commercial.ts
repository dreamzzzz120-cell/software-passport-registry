import { Router } from 'express';
import { randomUUID } from 'node:crypto';
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


const quoteSchema = z.object({
  clientId: z.string().min(1).max(256),
  passportId: z.string().min(1).max(256),
  serviceName: z.string().min(3).max(180),
  scope: z.string().min(15).max(8000),
  deliverables: z.array(z.string().min(1).max(500)).max(30),
  evidenceIds: z.array(z.string().min(1).max(256)).max(100),
  unknowns: z.array(z.string().min(1).max(500)).max(50),
  currency: z.literal('CAD'),
  amountCents: z.number().int().min(0).max(100000000),
}).strict();

// A quote is a recorded offer, NEVER a paid order, invoice or authorized Stripe checkout.
// The role-to-client binding is checked on every client-facing read and mutation.
router.get('/quotes', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const clientId = req.user!.role === 'Client' ? req.user!.clientId : null;
    const rows = (await req.db!.execute(sql`
      SELECT id, client_id AS "clientId", passport_id AS "passportId",
             service_name AS "serviceName", scope, deliverables, evidence_ids AS "evidenceIds",
             unknowns, currency, amount_cents AS "amountCents", status,
             created_at AS "createdAt", decided_at AS "decidedAt"
      FROM client_service_quotes WHERE tenant_id=${req.user!.tenantId}
        AND (${clientId}::text IS NULL OR client_id=${clientId})
        AND (${req.user!.role}::text <> 'Client' OR status <> 'DRAFT')
      ORDER BY created_at DESC LIMIT 100
    `) as any).rows ?? [];
    res.json({ quotes: rows, paymentStatus: 'NOT_INTEGRATED' });
  } catch (error) { next(error); }
});

router.post('/quotes', requireAuth, requireRole(['Owner','Admin']), async (req: AuthenticatedRequest, res, next) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUOTE', issues: parsed.error.issues });
  const data = parsed.data;
  try {
    const client = (await req.db!.execute(sql`SELECT id FROM clients WHERE tenant_id=${req.user!.tenantId} AND id=${data.clientId} LIMIT 1`) as any).rows?.[0];
    const passport = (await req.db!.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${data.passportId} LIMIT 1`) as any).rows?.[0];
    if (!client || !passport) return res.status(404).json({ error: 'CLIENT_OR_PASSPORT_NOT_FOUND' });
    const quoteId = 'quote_' + randomUUID().replace(/-/g,'');
    const row = (await req.db!.execute(sql`
      INSERT INTO client_service_quotes
      (id,tenant_id,client_id,passport_id,service_name,scope,deliverables,evidence_ids,unknowns,currency,amount_cents,created_by)
      VALUES (${quoteId},${req.user!.tenantId},${data.clientId},${data.passportId},${data.serviceName},${data.scope},
        ${JSON.stringify(data.deliverables)}::jsonb,${JSON.stringify(data.evidenceIds)}::jsonb,
        ${JSON.stringify(data.unknowns)}::jsonb,${data.currency},${data.amountCents},${req.user!.uid})
      RETURNING id,status
    `) as any).rows?.[0];
    await appendAuditEntry(req.db!, {tenantId:req.user!.tenantId, action:'commercial.quote.drafted',actor:req.user!.uid,payload:{quoteId,clientId:data.clientId,passportId:data.passportId}});
    res.status(201).json({ ...row, paymentStatus:'NOT_INTEGRATED' });
  } catch (error) { next(error); }
});

router.post('/quotes/:id/offer', requireAuth, requireRole(['Owner','Admin']), async (req: AuthenticatedRequest, res, next) => {
  try {
    const row = (await req.db!.execute(sql`
      UPDATE client_service_quotes SET status='OFFERED',updated_at=now()
      WHERE tenant_id=${req.user!.tenantId} AND id=${req.params.id} AND status='DRAFT'
      RETURNING id,status
    `) as any).rows?.[0];
    if (!row) return res.status(409).json({ error:'QUOTE_NOT_DRAFT_OR_NOT_FOUND' });
    await appendAuditEntry(req.db!,{tenantId:req.user!.tenantId,action:'commercial.quote.offered',actor:req.user!.uid,payload:{quoteId:row.id}});
    res.json({ ...row, paymentStatus:'NOT_INTEGRATED' });
  } catch (error) { next(error); }
});

router.post('/quotes/:id/decision', requireAuth, requireRole(['Client']), async (req: AuthenticatedRequest, res, next) => {
  const parsed = z.object({ decision:z.enum(['APPROVED','DECLINED']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:'INVALID_DECISION'});
  if (!req.user!.clientId) return res.status(403).json({error:'CLIENT_BINDING_REQUIRED'});
  try {
    const row = (await req.db!.execute(sql`
      UPDATE client_service_quotes SET status=${parsed.data.decision}, decided_by=${req.user!.uid},
          decided_at=now(),updated_at=now()
      WHERE tenant_id=${req.user!.tenantId} AND client_id=${req.user!.clientId}
        AND id=${req.params.id} AND status='OFFERED'
      RETURNING id,status
    `) as any).rows?.[0];
    if (!row) return res.status(409).json({error:'OFFER_NOT_AVAILABLE'});
    await appendAuditEntry(req.db!,{tenantId:req.user!.tenantId,action:'commercial.quote.decision',actor:req.user!.uid,payload:{quoteId:row.id,decision:row.status}});
    res.json({...row,paymentStatus:'NOT_INTEGRATED',message:'Quote decision recorded. No payment has been taken.'});
  } catch (error) { next(error); }
});

export function createCommercialRouter() { return router; }
