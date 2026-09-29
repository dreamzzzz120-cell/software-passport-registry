import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const createLeadSchema = z.object({
  companyName: z.string().trim().min(1).max(240),
  companyDomain: z.string().trim().toLowerCase().max(253).optional(),
  jurisdiction: z.string().trim().max(100).optional(),
}).strict();

const evidenceSchema = z.object({
  sourceType: z.string().trim().min(1).max(80),
  sourceLocator: z.string().trim().min(1).max(2048),
  observedFact: z.string().trim().min(1).max(4000),
  observedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  freshnessState: z.enum(['CURRENT','STALE','UNKNOWN']),
  rawEvidence: z.unknown().optional(),
}).strict();

const reviewSchema = z.object({
  decision: z.enum(['APPROVE','REJECT']),
  reason: z.string().trim().min(1).max(2000),
}).strict();

const transitionSchema = z.object({
  status: z.enum(['CONTACTED','REPLIED','MEETING','PROPOSAL','WON','LOST','DISQUALIFIED']),
}).strict();

const allowedTransitions: Record<string, readonly string[]> = {
  APPROVED: ['CONTACTED','DISQUALIFIED'],
  CONTACTED: ['REPLIED','LOST','DISQUALIFIED'],
  REPLIED: ['MEETING','LOST','DISQUALIFIED'],
  MEETING: ['PROPOSAL','LOST','DISQUALIFIED'],
  PROPOSAL: ['WON','LOST','DISQUALIFIED'],
};

const rows = (value: any) => value?.rows ?? [];

export function createMspLeadRouter() {
  const router = Router();

  router.get('/', requireRole(['Owner','Admin','Operator','Technician','Viewer']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await req.db!.execute(sql`SELECT id, company_name AS "companyName", company_domain AS "companyDomain", jurisdiction, status, qualification_rule_version AS "qualificationRuleVersion", qualification_confidence AS "qualificationConfidence", estimated_value_cents AS "estimatedValueCents", estimate_assumptions AS "estimateAssumptions", approved_at AS "approvedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM msp_leads WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC LIMIT 500`);
      return res.json({ leads: rows(result) });
    } catch (error) { return next(error); }
  });

  router.post('/', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const tenantId = req.user!.tenantId;
      const result = await req.db!.execute(sql`INSERT INTO msp_leads (tenant_id, company_name, company_domain, jurisdiction) VALUES (${tenantId}, ${parsed.data.companyName}, ${parsed.data.companyDomain ?? null}, ${parsed.data.jurisdiction ?? null}) RETURNING id, company_name AS "companyName", company_domain AS "companyDomain", jurisdiction, status, created_at AS "createdAt"`);
      const lead = rows(result)[0];
      await appendAuditEntry(req.db!, { tenantId, action: 'msp.lead.discovered', actor: req.user!.email, payload: { leadId: lead.id, companyName: lead.companyName } });
      return res.status(201).json(lead);
    } catch (error) { return next(error); }
  });

  router.post('/:leadId/evidence', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = evidenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const tenantId = req.user!.tenantId;
      const lead = rows(await req.db!.execute(sql`SELECT id FROM msp_leads WHERE id=${req.params.leadId} AND tenant_id=${tenantId} LIMIT 1`))[0];
      if (!lead) return res.status(404).json({ error: 'LEAD_NOT_FOUND' });
      const canonical = JSON.stringify({ sourceType: parsed.data.sourceType, sourceLocator: parsed.data.sourceLocator, observedFact: parsed.data.observedFact, observedAt: parsed.data.observedAt, rawEvidence: parsed.data.rawEvidence ?? null });
      const digest = createHash('sha256').update(canonical).digest('hex');
      const evidence = rows(await req.db!.execute(sql`INSERT INTO msp_lead_evidence (tenant_id, lead_id, source_type, source_locator, observed_fact, observed_at, evidence_digest, confidence, freshness_state, raw_evidence) VALUES (${tenantId}, ${req.params.leadId}, ${parsed.data.sourceType}, ${parsed.data.sourceLocator}, ${parsed.data.observedFact}, ${parsed.data.observedAt}, ${digest}, ${parsed.data.confidence}, ${parsed.data.freshnessState}, ${parsed.data.rawEvidence ?? null}) RETURNING id, evidence_digest AS "evidenceDigest", freshness_state AS "freshnessState", confidence, observed_at AS "observedAt"`))[0];
      await req.db!.execute(sql`UPDATE msp_leads SET status=CASE WHEN status='DISCOVERED' THEN 'EVIDENCE_PENDING' ELSE status END, updated_at=now() WHERE id=${req.params.leadId} AND tenant_id=${tenantId}`);
      await appendAuditEntry(req.db!, { tenantId, action: 'msp.lead.evidence_recorded', actor: req.user!.email, payload: { leadId: req.params.leadId, evidenceId: evidence.id, digest } });
      return res.status(201).json(evidence);
    } catch (error) { return next(error); }
  });

  router.post('/:leadId/qualify', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const current = rows(await req.db!.execute(sql`SELECT count(*)::int AS count, min(confidence)::float AS confidence FROM msp_lead_evidence WHERE tenant_id=${tenantId} AND lead_id=${req.params.leadId} AND freshness_state='CURRENT' AND confidence > 0`))[0];
      if (!current || Number(current.count) < 1) return res.status(409).json({ error: 'QUALIFICATION_EVIDENCE_REQUIRED', message: 'No current supporting evidence exists; qualification fails closed.' });
      const confidence = Math.max(0, Math.min(1, Number(current.confidence)));
      const updated = rows(await req.db!.execute(sql`UPDATE msp_leads SET status='REVIEW_REQUIRED', qualification_rule_version='spr.lead.minimum-current-evidence.v1', qualification_confidence=${confidence}, updated_at=now() WHERE id=${req.params.leadId} AND tenant_id=${tenantId} AND status IN ('DISCOVERED','EVIDENCE_PENDING') RETURNING id, status, qualification_rule_version AS "qualificationRuleVersion", qualification_confidence AS "qualificationConfidence"`))[0];
      if (!updated) return res.status(409).json({ error: 'INVALID_LEAD_STATE' });
      await appendAuditEntry(req.db!, { tenantId, action: 'msp.lead.qualified_for_review', actor: req.user!.email, payload: { leadId: req.params.leadId, ruleVersion: updated.qualificationRuleVersion, confidence } });
      return res.json(updated);
    } catch (error) { return next(error); }
  });

  router.post('/:leadId/review', requireRole(['Owner','Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const tenantId = req.user!.tenantId;
      const lead = rows(await req.db!.execute(sql`SELECT id, status FROM msp_leads WHERE id=${req.params.leadId} AND tenant_id=${tenantId} LIMIT 1`))[0];
      if (!lead) return res.status(404).json({ error: 'LEAD_NOT_FOUND' });
      if (lead.status !== 'REVIEW_REQUIRED') return res.status(409).json({ error: 'REVIEW_NOT_ALLOWED_IN_STATE' });
      await req.db!.execute(sql`INSERT INTO msp_lead_reviews (tenant_id, lead_id, reviewer_id, decision, reason) VALUES (${tenantId}, ${req.params.leadId}, ${req.user!.id}, ${parsed.data.decision}, ${parsed.data.reason})`);
      const nextStatus = parsed.data.decision === 'APPROVE' ? 'APPROVED' : 'DISQUALIFIED';
      await req.db!.execute(sql`UPDATE msp_leads SET status=${nextStatus}, approved_at=CASE WHEN ${parsed.data.decision}='APPROVE' THEN now() ELSE NULL END, approved_by=CASE WHEN ${parsed.data.decision}='APPROVE' THEN ${req.user!.id} ELSE NULL END, updated_at=now() WHERE id=${req.params.leadId} AND tenant_id=${tenantId}`);
      await appendAuditEntry(req.db!, { tenantId, action: 'msp.lead.human_reviewed', actor: req.user!.email, payload: { leadId: req.params.leadId, decision: parsed.data.decision, reason: parsed.data.reason } });
      return res.json({ id: req.params.leadId, status: nextStatus });
    } catch (error) { return next(error); }
  });

  router.post('/:leadId/transition', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const tenantId = req.user!.tenantId;
      const lead = rows(await req.db!.execute(sql`SELECT status FROM msp_leads WHERE id=${req.params.leadId} AND tenant_id=${tenantId} LIMIT 1`))[0];
      if (!lead) return res.status(404).json({ error: 'LEAD_NOT_FOUND' });
      if (!(allowedTransitions[lead.status] ?? []).includes(parsed.data.status)) return res.status(409).json({ error: 'INVALID_LEAD_TRANSITION', from: lead.status, to: parsed.data.status });
      await req.db!.execute(sql`UPDATE msp_leads SET status=${parsed.data.status}, updated_at=now() WHERE id=${req.params.leadId} AND tenant_id=${tenantId} AND status=${lead.status}`);
      await appendAuditEntry(req.db!, { tenantId, action: 'msp.lead.status_changed', actor: req.user!.email, payload: { leadId: req.params.leadId, from: lead.status, to: parsed.data.status } });
      return res.json({ id: req.params.leadId, status: parsed.data.status });
    } catch (error) { return next(error); }
  });

  return router;
}
