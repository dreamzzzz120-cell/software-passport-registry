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

const passportSchema = z.object({
  passportId: z.string().min(1).max(200),
  agentId: z.literal('comprehensive_scanner').optional(),
  jobType: z.enum(['osv_manifest_scan', 'automated_compliance_check']).optional(),
}).strict();
const scanSchema = z.object({
  targetName: z.string().min(1).max(300),
  scanType: z.enum(['SBOM Verify', 'Binary Attestation', 'Source Code Codeql', 'Container Image', 'Unclassified Attestation']).default('SBOM Verify'),
  clientName: z.string().min(1).max(200),
}).strict();
const scheduleSchema = z.object({
  assetId: z.string().min(1).max(200),
  assetHostName: z.string().min(1).max(300),
  assetType: z.string().min(1).max(200),
  clientName: z.string().min(1).max(200),
  frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
  scanType: z.string().min(1).max(200),
}).strict();
const scheduleUpdateSchema = z.object({ status: z.enum(['Active', 'Paused']) }).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

function nextRunAt(frequency: string, from = new Date()) {
  const next = new Date(from);
  if (frequency === 'Hourly') next.setHours(next.getHours() + 1);
  else if (frequency === 'Weekly') next.setDate(next.getDate() + 7);
  else if (frequency === 'Monthly') next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function createScansRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/scans', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT s.id, s.target_name AS "targetName", s.scan_type AS "scanType", s.triggered_by AS "triggeredBy", CASE WHEN s.job_id IS NOT NULL AND j.status='Completed' THEN 'Completed' WHEN s.job_id IS NOT NULL AND j.status='Failed' THEN 'Failed' ELSE s.status END AS status, s.duration_ms AS "durationMs", CASE WHEN s.job_id IS NOT NULL AND j.status='Completed' THEN COALESCE(s.findings_count, 0) ELSE s.findings_count END AS "findingsCount", s.timestamp, s.client_name AS "clientName", s.job_id AS "jobId" FROM scans s LEFT JOIN agent_jobs j ON j.id=s.job_id AND j.tenant_id=s.tenant_id WHERE s.tenant_id=${req.user!.tenantId} ORDER BY s.timestamp DESC LIMIT 100`);
      return res.json((result as any).rows || []);
    } catch (error) { return next(error); }
  });

  router.post('/scans', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = scanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const { targetName, scanType, clientName } = parsed.data;
      const timestamp = new Date().toISOString();
      const scanId = id('scan');
      const passport = (await db.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND (LOWER(name)=LOWER(${targetName}) OR id=${targetName}) LIMIT 1`)).rows?.[0] as any;
      if (!passport) {
        await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,job_id) VALUES (${scanId},${req.user!.tenantId},${targetName},${scanType},${req.user!.uid},'Failed',0,NULL,${timestamp},${clientName},NULL)`);
        return res.status(202).json({ id: scanId, targetName, scanType, triggeredBy: req.user!.uid, status: 'Failed', durationMs: 0, findingsCount: null, timestamp, clientName, error: 'No matching Software Passport exists for this scan target.' });
      }
      const jobId = id('job');
      await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,job_id) VALUES (${scanId},${req.user!.tenantId},${targetName},${scanType},${req.user!.uid},'Scanning',0,NULL,${timestamp},${clientName},${jobId})`);
      await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${jobId},${req.user!.tenantId},'comprehensive_scanner',${passport.id},'osv_manifest_scan','Pending',0,NOW(),NOW(),NOW())`);
      await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${jobId},'comprehensive_scanner','Queued real OSV dependency vulnerability scan against the persisted SBOM.','Info')`);
      return res.status(202).json({ id: scanId, jobId, targetName, scanType, triggeredBy: req.user!.uid, status: 'Scanning', durationMs: 0, findingsCount: null, timestamp, clientName });
    } catch (error) { return next(error); }
  });

  router.get('/scans/schedules', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, asset_id AS "assetId", asset_host_name AS "assetHostName", asset_type AS "assetType", client_name AS "clientName", frequency, scan_type AS "scanType", status, last_run_at AS "lastRunAt", next_run_at AS "nextRunAt", created_at AS "createdAt" FROM scan_schedules WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC`);
      return res.json((result as any).rows || []);
    } catch (error) { return next(error); }
  });

  router.post('/scans/schedules', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const data = parsed.data;
      const now = new Date();
      const schedule = {
        id: id('schedule'), assetId: data.assetId, assetHostName: data.assetHostName,
        assetType: data.assetType, clientName: data.clientName, frequency: data.frequency,
        scanType: data.scanType, status: 'Active', lastRunAt: null,
        nextRunAt: nextRunAt(data.frequency, now), createdAt: now.toISOString(),
      };
      await db.execute(sql`INSERT INTO scan_schedules (id,tenant_id,asset_id,asset_host_name,asset_type,client_name,frequency,scan_type,status,last_run_at,next_run_at,created_at) VALUES (${schedule.id},${req.user!.tenantId},${schedule.assetId},${schedule.assetHostName},${schedule.assetType},${schedule.clientName},${schedule.frequency},${schedule.scanType},${schedule.status},NULL,${schedule.nextRunAt},${schedule.createdAt})`);
      return res.status(201).json(schedule);
    } catch (error) { return next(error); }
  });

  router.put('/scans/schedules/:id', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = scheduleUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const result = await db.execute(sql`UPDATE scan_schedules SET status=${parsed.data.status} WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING id, asset_id AS "assetId", asset_host_name AS "assetHostName", asset_type AS "assetType", client_name AS "clientName", frequency, scan_type AS "scanType", status, last_run_at AS "lastRunAt", next_run_at AS "nextRunAt", created_at AS "createdAt"`);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Scan schedule not found' });
      return res.json(row);
    } catch (error) { return next(error); }
  });

  router.delete('/scans/schedules/:id', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`DELETE FROM scan_schedules WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'Scan schedule not found' });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  router.post('/scans/schedules/:id/run', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const schedule = (await db.execute(sql`SELECT id, asset_id AS "assetId", asset_host_name AS "assetHostName", asset_type AS "assetType", client_name AS "clientName", frequency, scan_type AS "scanType", status, last_run_at AS "lastRunAt", next_run_at AS "nextRunAt", created_at AS "createdAt" FROM scan_schedules WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} LIMIT 1`)).rows?.[0] as any;
      if (!schedule) return res.status(404).json({ error: 'Scan schedule not found' });
      if (schedule.status !== 'Active') return res.status(409).json({ error: 'Scan schedule is paused' });
      const passport = (await db.execute(sql`SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND (id=${schedule.assetId} OR LOWER(name)=LOWER(${schedule.assetHostName})) LIMIT 1`)).rows?.[0] as any;
      if (!passport) return res.status(422).json({ error: 'No matching Software Passport exists for this scheduled target.', queued: false });
      const now = new Date();
      const next = nextRunAt(schedule.frequency, now);
      const scanId = id('scan');
      const jobId = id('job');
      await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,job_id) VALUES (${scanId},${req.user!.tenantId},${schedule.assetHostName},${schedule.scanType},${req.user!.uid},'Scanning',0,NULL,${now.toISOString()},${schedule.clientName},${jobId})`);
      await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${jobId},${req.user!.tenantId},'comprehensive_scanner',${passport.id},'osv_manifest_scan','Pending',0,NOW(),NOW(),NOW())`);
      await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${jobId},'comprehensive_scanner',${'Scheduled OSV dependency scan dispatched for ' + schedule.assetHostName},'Info')`);
      const updated = (await db.execute(sql`UPDATE scan_schedules SET last_run_at=${now.toISOString()}, next_run_at=${next} WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} RETURNING id, asset_id AS "assetId", asset_host_name AS "assetHostName", asset_type AS "assetType", client_name AS "clientName", frequency, scan_type AS "scanType", status, last_run_at AS "lastRunAt", next_run_at AS "nextRunAt", created_at AS "createdAt"`)).rows?.[0];
      return res.status(202).json({ success: true, scanId, jobId, queued: true, schedule: updated });
    } catch (error) { return next(error); }
  });

  router.get('/agent-jobs', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, agent_id, passport_id, job_type, CASE WHEN status='Completed' THEN 'Success' ELSE status END AS status, status AS db_status, progress, result, error, attempt_count, max_attempts, completed_at, created_at, updated_at FROM agent_jobs WHERE tenant_id=${req.user!.tenantId} ORDER BY created_at DESC LIMIT 100`);
      return res.json((result as any).rows || []);
    } catch (error) { return next(error); }
  });

  router.get('/agent-jobs/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, agent_id AS "agentId", passport_id AS "passportId", job_type AS "jobType", status, progress, result, error, attempt_count AS "attemptCount", max_attempts AS "maxAttempts", completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM agent_jobs WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId} LIMIT 1`);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Agent job not found' });
      return res.json(row);
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
      if (!existingConnection) await db.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${req.user!.tenantId},'github','public-github','Public GitHub acquisition','public','Active')`);
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
