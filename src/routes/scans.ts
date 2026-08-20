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

const quickScanSchema = z.object({
  targetName: z.string().min(1).max(500),
  scanType: z.enum(['SBOM Verify', 'Binary Attestation', 'Source Code Codeql', 'Container Image']).default('SBOM Verify'),
  clientName: z.string().max(200).optional(),
  passportId: z.string().min(1).max(200).optional(),
}).strict();

const passportSchema = z.object({ passportId: z.string().min(1).max(200) }).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

function parseGitHubTarget(target: string): { owner: string; repository: string; ref: string } | null {
  const normalized = target.trim().replace(/\\/+$/, '');
  const direct = normalized.match(/^([A-Za-z0-9_.-]{1,100})\\/([A-Za-z0-9_.-]{1,100})(?:\\/tree\\/([^/]+))?$/);
  if (direct) return { owner: direct[1], repository: direct[2], ref: direct[3] ? decodeURIComponent(direct[3]) : 'main' };
  try {
    const url = new URL(normalized.match(/^https?:\\/\\//) ? normalized : `https://${normalized}`);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) return null;
    const ref = parts[2] === 'tree' && parts[3] ? decodeURIComponent(parts.slice(3).join('/')) : 'main';
    return { owner: parts[0], repository: parts[1].replace(/\\.git$/, ''), ref };
  } catch {
    return null;
  }
}

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

  // Backward-compatible quick-scan endpoint used by the Speed Dial UI.
  // It now queues the same real repository acquisition/Syft/OSV/security pipeline
  // as the canonical /api/scans/repository endpoint instead of writing to a
  // non-existent legacy `scans` table.
  router.post('/scans', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = quickScanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const target = parseGitHubTarget(parsed.data.targetName);
      if (!target) {
        return res.status(400).json({
          error: 'Unsupported scan target',
          message: 'Quick Scan currently accepts a GitHub repository as owner/repository or a GitHub repository URL.',
        });
      }

      const passport = parsed.data.passportId
        ? (await db.execute(sql`SELECT id FROM passports WHERE id=${parsed.data.passportId} AND tenant_id=${req.user!.tenantId} LIMIT 1`)).rows?.[0] as any
        : (await db.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC LIMIT 1`)).rows?.[0] as any;
      if (!passport) return res.status(404).json({ error: 'Passport not found', message: 'Create or select a passport before launching a scan.' });

      const existingConnection = (await db.execute(sql`SELECT id FROM repository_connections WHERE tenant_id=${req.user!.tenantId} AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`)).rows?.[0] as any;
      const connectionId = existingConnection?.id || id('repo');
      if (!existingConnection) {
        await db.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${req.user!.tenantId},'github','public-github','Public GitHub acquisition','public','Active')`);
      }

      const repositoryJobId = id('job');
      const securityJobId = id('job');
      await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${repositoryJobId},${req.user!.tenantId},'repository-scanner',${passport.id},'repository_scan','Pending',0,NOW(),NOW(),NOW()),(${securityJobId},${req.user!.tenantId},'security-scanner',${passport.id},'repository_security_scan','Pending',0,NOW(),NOW(),NOW())`);
      await db.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${req.user!.tenantId},${connectionId},'github',${target.owner},${target.repository},${target.ref},'',NOW())`);
      await db.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${securityJobId},${req.user!.tenantId},${connectionId},'github',${target.owner},${target.repository},${target.ref},'',NOW())`);
      await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${repositoryJobId},'repository-scanner',${`Quick Scan (${parsed.data.scanType}) queued real GitHub acquisition + pinned Syft SBOM + OSV dependency scan.`},'Info'),(${securityJobId},'security-scanner','Queued real secret, IaC/configuration, license, Syft and OSV scan.','Info')`);

      return res.status(202).json({
        id: repositoryJobId,
        repositoryJobId,
        securityJobId,
        status: 'Pending',
        scanType: parsed.data.scanType,
        targetName: `${target.owner}/${target.repository}`,
        clientName: parsed.data.clientName || null,
        findingsCount: 0,
        engines: ['Syft', 'OSV', 'Secret', 'IaC/Config', 'License'],
      });
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
