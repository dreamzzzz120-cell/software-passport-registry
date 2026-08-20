import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';

const repositorySchema = z.object({
  passportId: z.string().min(1).max(200),
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  ref: z.string().min(1).max(200).default('main'),
  subdirectory: z.string().max(500).default(''),
}).strict();

const passportSchema = z.object({ passportId: z.string().min(1).max(200) }).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

export function createScansRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/agent-jobs', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, agent_id, passport_id, job_type, status, progress, result, error, attempt_count, max_attempts, completed_at, created_at, updated_at FROM agent_jobs WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC LIMIT 100`);
      return res.json((result as any).rows || []);
    } catch (error) { return next(error); }
  });

  router.get('/agent-jobs/:id/logs', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT l.id, l.agent_id, l.message, l.level, l.timestamp FROM agent_logs l JOIN agent_jobs j ON j.id=l.job_id AND j.tenant_id=${req.user!.tenantId} WHERE l.job_id=${req.params.id} ORDER BY l.timestamp ASC, l.id ASC`);
      return res.json((result as any).rows || []);
    } catch (error) { return next(error); }
  });

  router.post('/agent-jobs', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = passportSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const passport = (await db.execute(sql`SELECT id FROM passports WHERE id=${parsed.data.passportId} AND tenant_id=${req.user!.tenantId} LIMIT 1`)).rows?.[0] as any;
      if (!passport) return res.status(404).json({ error: 'Passport not found' });
      const jobId = id('job');
      await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${jobId},${req.user!.tenantId},'comprehensive_scanner',${passport.id},'osv_manifest_scan','Pending',0,NOW(),NOW(),NOW())`);
      await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${jobId},'comprehensive_scanner','Queued real OSV dependency vulnerability scan against the persisted SBOM.','Info')`);
      return res.status(202).json({ id: jobId, status: 'Pending', jobType: 'osv_manifest_scan' });
    } catch (error) { return next(error); }
  });

  router.post('/scans/repository', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = repositorySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const { passportId, owner, repository, ref, subdirectory } = parsed.data;
      const passport = (await db.execute(sql`SELECT id FROM passports WHERE id=${passportId} AND tenant_id=${req.user!.tenantId} LIMIT 1`)).rows?.[0] as any;
      if (!passport) return res.status(404).json({ error: 'Passport not found' });
      const existingConnection = (await db.execute(sql`SELECT id FROM repository_connections WHERE tenant_id=${req.user!.tenantId} AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`)).rows?.[0] as any;
      const connectionId = existingConnection?.id || id('repo');
      if (!existingConnection) {
        await db.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${req.user!.tenantId},'github','public-github','Public GitHub acquisition','public','Active')`);
      }
      const repositoryJobId = id('job');
      const securityJobId = id('job');
      await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${repositoryJobId},${req.user!.tenantId},'repository-scanner',${passportId},'repository_scan','Pending',0,NOW(),NOW(),NOW()),(${securityJobId},${req.user!.tenantId},'security-scanner',${passportId},'repository_security_scan','Pending',0,NOW(),NOW(),NOW())`);
      await db.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${req.user!.tenantId},${connectionId},'github',${owner},${repository},${ref},${subdirectory},NOW())`);
      await db.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${securityJobId},${req.user!.tenantId},${connectionId},'github',${owner},${repository},${ref},${subdirectory},NOW())`);
      await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${repositoryJobId},'repository-scanner','Queued real GitHub acquisition + pinned Syft SBOM + OSV dependency scan.','Info'),(${securityJobId},'security-scanner','Queued real secret, IaC/configuration, license, Syft and OSV scan.','Info')`);
      return res.status(202).json({ repositoryJobId, securityJobId, status: 'Pending', engines: ['Syft','OSV','Secret','IaC/Config','License'] });
    } catch (error) { return next(error); }
  });

  return router;
}
