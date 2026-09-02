/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { config } from '../config.ts';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { signFreeReviewStatusToken, verifyFreeReviewStatusToken } from './public-connect.ts';

export const FREE_REVIEW_TENANT_ID = 'tenant-free-review-system';
const STATUS_TOKEN_TTL_SECONDS = 60 * 60 * 2;
const DAILY_SUBMISSIONS_PER_IP = 5;

const submitSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  ref: z.string().min(1).max(200).default('main'),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

function hashIp(req: { ip?: string; socket: { remoteAddress?: string } }) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return crypto.createHmac('sha256', config.publicPassport.secret || 'insecure-dev-only-key').update(ip).digest('hex');
}

export function createLegacyFreeReviewRouter() {
  const router = Router();
  router.post('/free-review/scan', async (req, res, next) => {
    try {
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      if (!config.publicPassport.secret) return res.status(503).json({ error: 'Free Review is not configured on this deployment' });
      const { owner, repository, ref } = parsed.data;
      const ipHash = hashIp(req);
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const recentCount = Number((await scopedDb.execute(sql`SELECT count(*)::int AS count FROM free_review_submissions WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND ip_hash=${ipHash} AND created_at > NOW() - INTERVAL '24 hours'`) as any).rows?.[0]?.count || 0);
      if (recentCount >= DAILY_SUBMISSIONS_PER_IP) return res.status(429).json({ error: 'Free Review daily limit reached for this network. Try again tomorrow, or sign up for continuous scanning.' });
      const passportId = id('passport_free');
      const existingConnection = (await scopedDb.execute(sql`SELECT id FROM repository_connections WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`) as any).rows?.[0];
      const connectionId = existingConnection?.id || id('repo');
      if (!existingConnection) await scopedDb.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${FREE_REVIEW_TENANT_ID},'github','public-github','Free Review public GitHub acquisition','public','Active')`);
      const repositoryJobId = id('job');
      const securityJobId = id('job');
      await scopedDb.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${repositoryJobId},${FREE_REVIEW_TENANT_ID},'repository-scanner',${passportId},'repository_scan','Pending',0,NOW(),NOW(),NOW()),(${securityJobId},${FREE_REVIEW_TENANT_ID},'security-scanner',${passportId},'repository_security_scan','Pending',0,NOW(),NOW(),NOW())`);
      await scopedDb.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${FREE_REVIEW_TENANT_ID},${connectionId},'github',${owner},${repository},${ref},'',NOW())`);
      await scopedDb.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${securityJobId},${FREE_REVIEW_TENANT_ID},${connectionId},'github',${owner},${repository},${ref},'',NOW())`);
      await scopedDb.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${repositoryJobId},'repository-scanner','Queued Free Review GitHub acquisition + Syft SBOM + OSV dependency scan.','Info'),(${securityJobId},'security-scanner','Queued Free Review secret, IaC/configuration, license and OSV scan.','Info')`);
      await scopedDb.execute(sql`INSERT INTO free_review_submissions (id,tenant_id,passport_id,repository_owner,repository_name,ip_hash,status) VALUES (${id('freereview')},${FREE_REVIEW_TENANT_ID},${passportId},${owner},${repository},${ipHash},'Pending')`);
      const expiresAt = Math.floor(Date.now() / 1000) + STATUS_TOKEN_TTL_SECONDS;
      const token = signFreeReviewStatusToken(passportId, expiresAt);
      return res.status(202).json({ passportId, statusUrl: `/api/free-review/scan/${encodeURIComponent(passportId)}/status/${encodeURIComponent(token)}`, expiresAt: new Date(expiresAt * 1000).toISOString() });
    } catch (error) { return next(error); }
  });
  router.get('/free-review/scan/:passportId/status/:token', async (req, res, next) => {
    try {
      const passportId = req.params.passportId;
      const payload = verifyFreeReviewStatusToken(req.params.token, passportId);
      if (!payload) return res.status(401).json({ error: 'Invalid or expired Free Review status link' });
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const jobs = (await scopedDb.execute(sql`SELECT job_type, status, error FROM agent_jobs WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND passport_id=${passportId}`) as any).rows || [];
      if (jobs.length === 0) return res.status(404).json({ error: 'Free Review submission not found' });
      const pending = jobs.some((j: any) => ['Pending', 'Running'].includes(j.status));
      const anyFailed = jobs.some((j: any) => j.status === 'Failed');
      const scanStatus = pending ? 'scanning' : anyFailed ? 'partial' : 'complete';
      const passport = (await scopedDb.execute(sql`SELECT id, name, version, publisher, category, verification_status AS "verificationStatus" FROM passports WHERE id=${passportId} AND tenant_id=${FREE_REVIEW_TENANT_ID} LIMIT 1`) as any).rows?.[0] || null;
      const findings = (await scopedDb.execute(sql`SELECT id, severity, category, title, description, component, fixed_version AS "fixedVersion", status, detected_at AS "detectedAt", engine_id AS "engineId" FROM scan_findings WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND asset_id=${passportId} ORDER BY detected_at DESC`) as any).rows || [];
      const evidence = (await scopedDb.execute(sql`SELECT id, name, type, verified, status, signer, timestamp, engine_id AS "engineId" FROM evidence_items WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND asset_id=${passportId} ORDER BY timestamp DESC`) as any).rows || [];
      const openFindings = findings.filter((f: any) => !['resolved', 'closed', 'verified'].includes(String(f.status).toLowerCase()));
      const criticalOrHigh = openFindings.filter((f: any) => ['critical', 'high'].includes(String(f.severity).toLowerCase()));
      res.setHeader('cache-control', 'private, max-age=0, no-store');
      return res.json({ passportId, scanStatus, passport, summary: { openFindings: openFindings.length, criticalOrHigh: criticalOrHigh.length, evidenceCount: evidence.length }, findings, evidence, policy: { rule: 'SPR reports observed evidence only. A scan still in progress reports scanStatus "scanning", never a placeholder result.' } });
    } catch (error) { return next(error); }
  });
  return router;
}
