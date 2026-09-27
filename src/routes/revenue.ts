import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { listRevenueReviewCandidates } from '../agents/revenue-query.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const review = z.object({
  findingId: z.string().trim().min(1).max(255),
  action: z.enum(['ACCEPTED_FOR_REVIEW', 'DISMISSED']),
  idempotencyKey: z.string().trim().min(8).max(128)
}).strict();

export function createRevenueRouter() {
  const router = Router();
  router.use(requireAuth, requireRole(['Owner', 'Admin', 'Operator']));

  router.get('/reviews', async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`SELECT id, finding_id AS "findingId", passport_id AS "passportId",
        client_id AS "clientId", action, actor_id AS "actorId", evidence_ids AS "evidenceIds",
        created_at AS "createdAt" FROM revenue_opportunity_reviews
        WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC LIMIT 100`) as any).rows ?? [];
      return res.json({ reviews: rows, incomplete: rows.length === 100 });
    } catch (error) { return next(error); }
  });

  router.post('/reviews', async (req: AuthenticatedRequest, res, next) => {
    const parsed = review.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REVENUE_REVIEW' });
    try {
      const tenantId = req.user!.tenantId;
      const { findingId, action, idempotencyKey } = parsed.data;
      // The request-scoped database is already in a tenant-bound transaction.
      // Serialize this tenant's audit chain and idempotency check together.
      await req.db!.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`);
      const prior = (await req.db!.execute(sql`SELECT id, finding_id AS "findingId", action
        FROM revenue_opportunity_reviews WHERE tenant_id=${tenantId} AND idempotency_key=${idempotencyKey} LIMIT 1`) as any).rows?.[0];
      if (prior) {
        if (prior.findingId !== findingId || prior.action !== action) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED' });
        return res.json({ id: prior.id, findingId, action, reused: true });
      }
      const candidate = (await listRevenueReviewCandidates(req.db!, tenantId, { findingId, limit: 1 })).opportunities[0];
      if (!candidate) return res.status(409).json({ error: 'REVENUE_CANDIDATE_NO_LONGER_SUPPORTED' });
      const id = `rev_${randomUUID()}`;
      await req.db!.execute(sql`INSERT INTO revenue_opportunity_reviews
        (id,tenant_id,finding_id,passport_id,client_id,action,actor_id,evidence_ids,idempotency_key)
        VALUES (${id},${tenantId},${findingId},${candidate.passportId},${candidate.clientId},
          ${action},${req.user!.uid},${JSON.stringify(candidate.evidenceIds)}::jsonb,${idempotencyKey})`);
      await appendAuditEntry(req.db!, { tenantId, action: 'revenue.opportunity.reviewed', actor: req.user!.uid,
        payload: { reviewId: id, findingId, action, evidenceIds: candidate.evidenceIds } });
      const webhooks = (await req.db!.execute(sql`SELECT id FROM spr_webhooks WHERE tenant_id=${tenantId}
        AND active=true AND events::jsonb @> ${JSON.stringify(['opportunity.reviewed'])}::jsonb`) as any).rows ?? [];
      const now = new Date().toISOString();
      for (const webhook of webhooks) {
        const webhookId = String(webhook.id);
        const dedup = createHash('sha256').update(`${tenantId}:${webhookId}:${id}`).digest('hex');
        const payload = JSON.stringify({ schemaVersion: 'spr-revenue-review-v1', reviewId: id,
          findingId, action, requiresHumanApprovalForExternalAction: true });
        await req.db!.execute(sql`INSERT INTO spr_webhook_deliveries
          (id,tenant_id,webhook_id,event_id,event_type,payload,idempotency_key,attempt_number,status,next_attempt_at,created_at)
          VALUES (${`wh-delivery-${randomUUID()}`},${tenantId},${webhookId},${id},'opportunity.reviewed',
            ${payload},${dedup},1,'queued',${now},${now})
          ON CONFLICT (tenant_id,webhook_id,idempotency_key) DO NOTHING`);
      }
      return res.status(201).json({ id, findingId, action, evidenceIds: candidate.evidenceIds,
        requiresHumanApprovalForExternalAction: true });
    } catch (error) { return next(error); }
  });
  return router;
}
