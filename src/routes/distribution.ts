import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireAuth, requireFounder, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { DISTRIBUTION_TENANT_ID, enqueueResearchUrl, enqueueDistributionJob } from '../lib/distribution-engine.ts';

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
const urlSchema = z.object({ url: z.string().trim().url().max(2048) }).strict();
const leadSchema = z.object({ leadId: z.string().trim().min(1).max(200) }).strict();
const MAX_BATCH = 100;

export function createDistributionRouter() {
  const router = Router();
  const founderOnly = [requireAuth, requireRole('Owner'), requireFounder, limiter];

  router.post('/founder/distribution/research', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = urlSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'A valid HTTP(S) URL is required.' });
      const jobId = await enqueueResearchUrl(db, parsed.data.url);
      return res.status(202).json({ jobId, status: 'queued' });
    } catch (error) { return next(error); }
  });

  router.post('/founder/distribution/research-batch', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
      if (urls.length < 1 || urls.length > MAX_BATCH) return res.status(400).json({ error: `Provide 1-${MAX_BATCH} URLs.` });
      const ids: string[] = [];
      for (const value of urls) {
        const parsed = urlSchema.safeParse({ url: value });
        if (!parsed.success) return res.status(400).json({ error: 'Every URL must be a valid HTTP(S) URL.' });
        ids.push(await enqueueResearchUrl(db, parsed.data.url));
      }
      return res.status(202).json({ status: 'queued', count: ids.length, jobIds: ids });
    } catch (error) { return next(error); }
  });

  router.post('/founder/distribution/qualify-lead', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = leadSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'A leadId is required.' });
      const result = await db.execute(sql`SELECT id, name, email, company FROM free_review_leads WHERE tenant_id = ${DISTRIBUTION_TENANT_ID} AND id = ${parsed.data.leadId} LIMIT 1`);
      const lead = (result as any).rows?.[0];
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });
      const jobId = await enqueueDistributionJob(db, 'qualify_lead', { leadId: lead.id, name: lead.name, email: lead.email, company: lead.company ?? '' });
      return res.status(202).json({ jobId, status: 'queued' });
    } catch (error) { return next(error); }
  });

  router.get('/founder/distribution/status', ...founderOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT status, COUNT(*)::int AS count
        FROM distribution_jobs
        WHERE tenant_id = ${DISTRIBUTION_TENANT_ID}
        GROUP BY status
        ORDER BY status
      `);
      const rows = (result as any).rows ?? [];
      const counts: Record<string, number> = {};
      for (const row of rows) counts[String(row.status)] = Number(row.count);
      return res.json({ counts, generatedAt: new Date().toISOString() });
    } catch (error) { return next(error); }
  });

  return router;
}
