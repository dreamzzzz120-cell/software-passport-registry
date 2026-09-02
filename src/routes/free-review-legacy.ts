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
// A Free Review stops calling itself "scanning" after this long. It bounds the
// visitor's wait; it does not cancel the job, and it never invents a result.
const FREE_REVIEW_DEADLINE_MS = 4 * 60 * 1000;

const submitSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  // Deliberately NOT defaulted to 'main'. This default was stored verbatim in
  // repository_scan_sources.requested_ref, so the worker's own
  // `source.requested_ref || defaultBranch` fallback could never fire for a Free
  // Review: the value was always the literal string 'main'. Every repository on
  // master, trunk or develop failed with REPOSITORY_REF_NOT_FOUND. Left absent,
  // the worker resolves the repository's real default branch from the metadata
  // it already fetches. A caller may still pin an explicit ref.
  ref: z.string().min(1).max(200).optional(),
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
      // null, not 'main': the worker resolves the repository's real default branch.
      const requestedRef = ref ?? null;
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
      await scopedDb.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${FREE_REVIEW_TENANT_ID},${connectionId},'github',${owner},${repository},${requestedRef},'',NOW())`);
      await scopedDb.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${securityJobId},${FREE_REVIEW_TENANT_ID},${connectionId},'github',${owner},${repository},${requestedRef},'',NOW())`);
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
      const jobs = (await scopedDb.execute(sql`SELECT job_type, status, error, created_at AS "createdAt" FROM agent_jobs WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND passport_id=${passportId}`) as any).rows || [];
      if (jobs.length === 0) return res.status(404).json({ error: 'Free Review submission not found' });
      // A Free Review is bounded. The two engines retry on different schedules --
      // the security scanner on a flat 30s backoff, the repository scanner on an
      // exponential one that reaches an hour -- so a job can sit in 'Pending'
      // long after the review is, in every sense the visitor cares about, over.
      // Reporting 'scanning' until the slowest retry chain gives up is what made
      // the page appear to load forever.
      //
      // Past the deadline SPR stops claiming to be scanning and reports what it
      // actually has. This never invents a result: a review that produced
      // evidence still reports it, and one that produced none is reported as
      // failed, not as a clean scan.
      const oldestStartedAt = jobs.reduce((oldest: number, j: any) => {
        const started = new Date(j.createdAt ?? Date.now()).getTime();
        return Number.isFinite(started) && started < oldest ? started : oldest;
      }, Date.now());
      const pastDeadline = Date.now() - oldestStartedAt > FREE_REVIEW_DEADLINE_MS;
      const pending = !pastDeadline && jobs.some((j: any) => ['Pending', 'Running'].includes(j.status));
      // 'Completed' is the workers' terminal success status. A job left Pending or
      // Running past the deadline did not succeed, so it is counted as unfinished
      // rather than silently folded into a clean result.
      const succeeded = jobs.filter((j: any) => j.status === 'Completed');
      const unfinished = jobs.filter((j: any) => ['Pending', 'Running'].includes(j.status));
      const anyFailed = jobs.some((j: any) => j.status === 'Failed');
      // A run where NO engine succeeded is not a partial review, it is no review at
      // all: nothing was fetched, nothing was scanned, and the zero counts below
      // describe absence of a scan rather than absence of findings. Collapsing that
      // into "partial" is what let the UI show a green "Review complete" with 0
      // findings and 0 evidence for a repository SPR never managed to read --
      // exactly the fabricated assurance this product exists to prevent.
      const scanStatus = pending
        ? 'scanning'
        : succeeded.length === 0
          ? 'failed'
          : (anyFailed || unfinished.length > 0)
            ? 'partial'
            : 'complete';
      // These codes describe the caller's own input, so returning them tells the
      // customer something actionable without disclosing anything internal.
      // Anything unrecognized is deliberately generalized rather than echoed back.
      const FAILURE_REASONS: Record<string, string> = {
        REPOSITORY_NOT_FOUND: 'That repository could not be found on GitHub. Check the owner and repository name.',
        REPOSITORY_REF_NOT_FOUND: 'That repository exists, but its default branch could not be read.',
        REPOSITORY_ACCESS_DENIED: 'That repository is private or not publicly accessible. Free Review only scans public repositories.',
        REPOSITORY_ACQUISITION_FAILED: 'The repository could not be downloaded for scanning.',
        REPOSITORY_PATH_INVALID: 'The requested path inside that repository is not valid.',
        REPOSITORY_CONNECTION_NOT_FOUND: 'This review is no longer available. Start a new Free Review.',
      };
      const rawReason = jobs.find((j: any) => j.status === 'Failed' && j.error)?.error;
      // Only reported once the review has actually settled. Returning a reason
      // beside scanStatus 'scanning' told the visitor the run had failed while the
      // UI was still spinning -- two contradictory answers in one payload.
      const failureReason = pending
        ? null
        : rawReason
          ? FAILURE_REASONS[String(rawReason).trim()] || 'The scan could not be completed. No evidence was collected.'
          : unfinished.length > 0
            ? 'The scan did not finish in time. No result was produced, so nothing here should be read as a clean review.'
            : null;
      const passport = (await scopedDb.execute(sql`SELECT id, name, version, publisher, category, verification_status AS "verificationStatus" FROM passports WHERE id=${passportId} AND tenant_id=${FREE_REVIEW_TENANT_ID} LIMIT 1`) as any).rows?.[0] || null;
      const findings = (await scopedDb.execute(sql`SELECT id, severity, category, title, description, component, fixed_version AS "fixedVersion", status, detected_at AS "detectedAt", engine_id AS "engineId" FROM scan_findings WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND asset_id=${passportId} ORDER BY detected_at DESC`) as any).rows || [];
      const evidence = (await scopedDb.execute(sql`SELECT id, name, type, verified, status, signer, timestamp, engine_id AS "engineId" FROM evidence_items WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND asset_id=${passportId} ORDER BY timestamp DESC`) as any).rows || [];
      const openFindings = findings.filter((f: any) => !['resolved', 'closed', 'verified'].includes(String(f.status).toLowerCase()));
      const criticalOrHigh = openFindings.filter((f: any) => ['critical', 'high'].includes(String(f.severity).toLowerCase()));
      res.setHeader('cache-control', 'private, max-age=0, no-store');
      return res.json({ passportId, scanStatus, failureReason, passport, summary: { openFindings: openFindings.length, criticalOrHigh: criticalOrHigh.length, evidenceCount: evidence.length }, findings, evidence, policy: { rule: 'SPR reports observed evidence only. A scan still in progress reports scanStatus "scanning", never a placeholder result. A scan where every engine failed reports "failed", and its zero counts mean nothing was scanned -- not that nothing was found.' } });
    } catch (error) { return next(error); }
  });
  return router;
}
