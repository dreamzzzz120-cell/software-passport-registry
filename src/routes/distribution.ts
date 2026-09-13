import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { appPool, db } from '../db/index.ts';
import { requireAuth, requireFounder, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { DISTRIBUTION_TENANT_ID, enqueueResearchUrl, enqueueDistributionJob } from '../lib/distribution-engine.ts';
import { buildMspDiscoveryQueries, dedupeDiscoveryResults, type DiscoveryProvider } from '../lib/distribution-discovery.ts';
import { unsubscribeContact, autonomousOutreachEnabled } from '../lib/distribution-outreach.ts';

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
const publicLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
const urlSchema = z.object({ url: z.string().trim().url().max(2048) }).strict();
const leadSchema = z.object({ leadId: z.string().trim().min(1).max(200) }).strict();
const discoverySchema = z.object({ query: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(50).optional() }).strict();
const MAX_BATCH = 100;
const MAX_OPPORTUNITIES = 100;

function configuredDiscoveryProvider(): DiscoveryProvider {
  const endpoint = process.env.DISTRIBUTION_DISCOVERY_PROVIDER_URL?.trim();
  if (!endpoint) throw new Error('DISTRIBUTION_DISCOVERY_PROVIDER_NOT_CONFIGURED');
  const parsed = new URL(endpoint);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_DISCOVERY_PROVIDER_SCHEME_NOT_ALLOWED');
  return { name: 'configured-http-provider', async discover(query, limit) {
    const target = new URL(parsed.toString()); target.searchParams.set('q', query); target.searchParams.set('limit', String(limit));
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(target, { signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json', 'user-agent': 'SPR-Distribution-Discovery/1.0 (+https://www.softwarepassportregistry.com)' } });
      if (!response.ok) throw new Error(`DISTRIBUTION_DISCOVERY_PROVIDER_HTTP_${response.status}`);
      const data: unknown = await response.json();
      const rows = data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results) ? (data as { results: unknown[] }).results : [];
      return rows.slice(0, limit).flatMap((row) => {
        if (!row || typeof row !== 'object' || typeof (row as { url?: unknown }).url !== 'string') return [];
        try { const url = new URL((row as { url: string }).url); if (!['http:','https:'].includes(url.protocol)) return []; return [{ url: url.toString(), title: typeof (row as { title?: unknown }).title === 'string' ? (row as { title: string }).title.slice(0,500) : undefined, source: this.name, discoveredAt: new Date().toISOString() }]; }
        catch { return []; }
      });
    } finally { clearTimeout(timeout); }
  } };
}

export function createDistributionRouter() {
  const router = Router();

  router.get('/public/distribution/unsubscribe', publicLimiter, async (req, res) => {
    try {
      const email = typeof req.query.email === 'string' ? req.query.email : '';
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!email || !token) return res.status(400).type('html').send('<h1>Invalid unsubscribe link</h1>');
      await unsubscribeContact(email, token);
      return res.status(200).type('html').send('<!doctype html><html><body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:20px"><h1>You are unsubscribed</h1><p>SPR will not send further distribution outreach to this address.</p></body></html>');
    } catch { return res.status(400).type('html').send('<h1>Invalid unsubscribe link</h1>'); }
  });

  const founderOnly = [requireAuth, requireRole('Owner'), requireFounder, limiter];
  router.post('/founder/distribution/research', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try { const parsed = urlSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'A valid HTTP(S) URL is required.' }); const jobId = await enqueueResearchUrl(appPool, parsed.data.url); return res.status(202).json({ jobId, status: 'queued' }); }
    catch (error) { return next(error); }
  });
  router.post('/founder/distribution/research-batch', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try { const urls = Array.isArray(req.body?.urls) ? req.body.urls : []; if (urls.length < 1 || urls.length > MAX_BATCH) return res.status(400).json({ error: `Provide 1-${MAX_BATCH} URLs.` }); const ids: string[] = []; for (const value of urls) { const parsed = urlSchema.safeParse({ url: value }); if (!parsed.success) return res.status(400).json({ error: 'Every URL must be a valid HTTP(S) URL.' }); ids.push(await enqueueResearchUrl(appPool, parsed.data.url)); } return res.status(202).json({ status: 'queued', count: ids.length, jobIds: ids }); }
    catch (error) { return next(error); }
  });
  router.get('/founder/distribution/discovery/queries', ...founderOnly, (_req: AuthenticatedRequest, res) => res.json({ queries: buildMspDiscoveryQueries(), evidencePolicy: 'Queries are discovery prompts, not evidence that a company is an MSP.' }));
  router.post('/founder/distribution/discovery/run', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try { const parsed = discoverySchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'A valid discovery query is required.' }); const provider = configuredDiscoveryProvider(); const raw = await provider.discover(parsed.data.query, parsed.data.limit ?? 25); const unique = dedupeDiscoveryResults(raw); const queued: string[] = []; for (const result of unique) queued.push(await enqueueResearchUrl(appPool, result.url)); return res.status(202).json({ status: 'queued', provider: provider.name, query: parsed.data.query, discovered: unique.length, queued: queued.length, results: unique, evidencePolicy: 'Discovery results are candidates only. Website research is observational and scoring is heuristic; review evidence before contacting.' }); }
    catch (error) { return next(error); }
  });
  router.post('/founder/distribution/qualify-lead', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try { const parsed = leadSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'A leadId is required.' }); const result = await db.execute(sql`SELECT id, name, email, company FROM free_review_leads WHERE tenant_id = ${DISTRIBUTION_TENANT_ID} AND id = ${parsed.data.leadId} LIMIT 1`); const lead = (result as any).rows?.[0]; if (!lead) return res.status(404).json({ error: 'Lead not found.' }); const jobId = await enqueueDistributionJob(appPool, 'qualify_lead', { leadId: lead.id, name: lead.name, email: lead.email, company: lead.company ?? '' }); return res.status(202).json({ jobId, status: 'queued' }); }
    catch (error) { return next(error); }
  });
  router.get('/founder/distribution/status', ...founderOnly, async (_req: AuthenticatedRequest, res, next) => {
    try { const result = await db.execute(sql`SELECT status, COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id = ${DISTRIBUTION_TENANT_ID} GROUP BY status ORDER BY status`); const rows = (result as any).rows ?? []; const counts: Record<string, number> = {}; for (const row of rows) counts[String(row.status)] = Number(row.count); return res.json({ counts, autonomousOutreachEnabled: autonomousOutreachEnabled(), generatedAt: new Date().toISOString() }); }
    catch (error) { return next(error); }
  });
  router.get('/founder/distribution/opportunities', ...founderOnly, async (_req: AuthenticatedRequest, res, next) => {
    try { const result = await db.execute(sql`SELECT id, kind, result, created_at, updated_at FROM distribution_jobs WHERE tenant_id = ${DISTRIBUTION_TENANT_ID} AND status = 'succeeded' AND kind IN ('research_url', 'qualify_lead') ORDER BY updated_at DESC LIMIT ${MAX_OPPORTUNITIES * 3}`); const rows = (result as any).rows ?? []; const opportunities = rows.map((row: any) => { const value = row.result && typeof row.result === 'object' ? row.result : {}; const score = typeof value.score === 'number' ? value.score : null; const signals = value.signals && typeof value.signals === 'object' ? value.signals : null; return { jobId: String(row.id), kind: String(row.kind), score, company: typeof value.company === 'string' && value.company.trim() ? value.company.trim() : null, url: typeof value.url === 'string' && value.url.trim() ? value.url.trim() : null, leadId: typeof value.leadId === 'string' ? value.leadId : null, businessEmail: typeof value.businessEmail === 'boolean' ? value.businessEmail : null, publicRoleEmails: Array.isArray(value.publicRoleEmails) ? value.publicRoleEmails : [], signals, observedAt: typeof value.observedAt === 'string' ? value.observedAt : null, jobUpdatedAt: row.updated_at }; }).filter((item: any) => item.score !== null).sort((a: any,b: any) => (b.score ?? -1)-(a.score ?? -1) || String(b.jobUpdatedAt).localeCompare(String(a.jobUpdatedAt))).slice(0,MAX_OPPORTUNITIES); return res.json({ opportunities, generatedAt: new Date().toISOString(), evidencePolicy: 'Scores are heuristic observations from stored job results; review source evidence before contacting.' }); }
    catch (error) { return next(error); }
  });
  return router;
}
