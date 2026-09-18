/**
 * The single way a scan enters the system. Every submission -- an
 * authenticated customer's repository or upload, a scheduled re-scan, an
 * anonymous Free Review -- creates the same rows here: a scan_runs ledger row
 * with a stable id, the customer-facing scans row linked to it, the worker
 * jobs that will process it, and their sources. A scan therefore has a
 * persistent, queryable identity before any worker has touched it, and it
 * keeps that identity whatever happens afterwards.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { scanRunId } from './scan-ledger.ts';

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

export interface RepositorySubmission {
  tenantId: string;
  clientId: string | null;
  passportId: string;
  owner: string;
  repository: string;
  /** null lets the worker resolve the repository's real default branch. */
  ref: string | null;
  subdirectory: string;
  triggeredBy: string;
  /** Display name for the scans list (the passport name when one exists). */
  targetName: string;
  clientName: string;
  scanType?: string;
  /** Free Review queues its own connection label; everything else uses the tenant's public-GitHub connection. */
  connectionLabel?: string;
}

export interface SubmittedScan { scanRunId: string; scanId: string; repositoryJobId: string; securityJobId: string }

export async function enqueueRepositoryScan(db: ScopedDb, input: RepositorySubmission): Promise<SubmittedScan> {
  const existingConnection = (await db.execute(sql`SELECT id FROM repository_connections WHERE tenant_id=${input.tenantId} AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`) as any).rows?.[0];
  const connectionId = existingConnection?.id || id('repo');
  if (!existingConnection) await db.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${input.tenantId},'github','public-github',${input.connectionLabel ?? 'Public GitHub acquisition'},'public','Active')`);
  const runId = scanRunId();
  const scanId = id('scan');
  const repositoryJobId = id('job');
  const securityJobId = id('job');
  const sourceRef = `${input.owner}/${input.repository}@${input.ref ?? 'default'}${input.subdirectory ? `:${input.subdirectory}` : ''}`;
  const now = new Date().toISOString();
  await db.execute(sql`INSERT INTO scan_runs (id,tenant_id,client_id,passport_id,source_kind,source_ref,status,repository_job_id,security_job_id,triggered_by,created_at,updated_at) VALUES (${runId},${input.tenantId},${input.clientId},${input.passportId},'github',${sourceRef},'queued',${repositoryJobId},${securityJobId},${input.triggeredBy},NOW(),NOW())`);
  await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,scan_run_id,passport_id,client_id) VALUES (${scanId},${input.tenantId},${input.targetName},${input.scanType ?? 'Repository scan'},${input.triggeredBy},'Queued',0,NULL,${now},${input.clientName},${runId},${input.passportId},${input.clientId})`);
  await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at,scan_run_id) VALUES (${repositoryJobId},${input.tenantId},'repository-scanner',${input.passportId},'repository_scan','Pending',0,NOW(),NOW(),NOW(),${runId}),(${securityJobId},${input.tenantId},'security-scanner',${input.passportId},'repository_security_scan','Pending',0,NOW(),NOW(),NOW(),${runId})`);
  await db.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${input.tenantId},${connectionId},'github',${input.owner},${input.repository},${input.ref},${input.subdirectory},NOW()),(${id('source')},${securityJobId},${input.tenantId},${connectionId},'github',${input.owner},${input.repository},${input.ref},${input.subdirectory},NOW())`);
  await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${repositoryJobId},'repository-scanner',${`Queued GitHub acquisition + file inventory + pinned Syft SBOM + OSV dependency scan (scan ${runId}).`},'Info'),(${securityJobId},'security-scanner',${`Queued file inventory + secret, IaC/configuration, license, Syft and OSV scan (scan ${runId}).`},'Info')`);
  return { scanRunId: runId, scanId, repositoryJobId, securityJobId };
}

export interface UploadSubmission {
  tenantId: string;
  clientId: string | null;
  passportId: string;
  sessionId: string;
  itemCount: number;
  triggeredBy: string;
  targetName: string;
  clientName: string;
}

export async function enqueueUploadScan(db: ScopedDb, input: UploadSubmission): Promise<{ scanRunId: string; scanId: string; intakeJobId: string }> {
  const runId = scanRunId();
  const scanId = id('scan');
  const intakeJobId = id('job');
  const now = new Date().toISOString();
  await db.execute(sql`INSERT INTO scan_runs (id,tenant_id,client_id,passport_id,source_kind,source_ref,status,intake_job_id,intake_session_id,triggered_by,created_at,updated_at) VALUES (${runId},${input.tenantId},${input.clientId},${input.passportId},'upload',${`intake:${input.sessionId}`},'queued',${intakeJobId},${input.sessionId},${input.triggeredBy},NOW(),NOW())`);
  await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,scan_run_id,passport_id,client_id) VALUES (${scanId},${input.tenantId},${input.targetName},'Uploaded files scan',${input.triggeredBy},'Queued',0,NULL,${now},${input.clientName},${runId},${input.passportId},${input.clientId})`);
  await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at,scan_run_id) VALUES (${intakeJobId},${input.tenantId},'intake-scanner',${input.passportId},'intake_scan','Pending',0,NOW(),NOW(),NOW(),${runId})`);
  await db.execute(sql`INSERT INTO intake_scan_sources (id,job_id,scan_run_id,tenant_id,session_id,item_count,created_at) VALUES (${id('source')},${intakeJobId},${runId},${input.tenantId},${input.sessionId},${input.itemCount},NOW())`);
  await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${intakeJobId},'intake-scanner',${`Queued uploaded-file inventory, archive enumeration, Syft SBOM, OSV and content scan over ${input.itemCount} uploaded item(s) (scan ${runId}).`},'Info')`);
  return { scanRunId: runId, scanId, intakeJobId };
}

export interface SbomSubmission { tenantId: string; clientId: string | null; passportId: string; triggeredBy: string; targetName: string; clientName: string; scanType: string }

/** An OSV query over the passport's persisted SBOM. No files are involved, so no inventory is produced -- the ledger row says so. */
export async function enqueueSbomScan(db: ScopedDb, input: SbomSubmission): Promise<{ scanRunId: string; scanId: string; jobId: string }> {
  const runId = scanRunId();
  const scanId = id('scan');
  const jobId = id('job');
  const now = new Date().toISOString();
  await db.execute(sql`INSERT INTO scan_runs (id,tenant_id,client_id,passport_id,source_kind,source_ref,status,repository_job_id,triggered_by,created_at,updated_at) VALUES (${runId},${input.tenantId},${input.clientId},${input.passportId},'sbom',${`passport:${input.passportId}`},'queued',${jobId},${input.triggeredBy},NOW(),NOW())`);
  await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,scan_run_id,passport_id,client_id) VALUES (${scanId},${input.tenantId},${input.targetName},${input.scanType},${input.triggeredBy},'Queued',0,NULL,${now},${input.clientName},${runId},${input.passportId},${input.clientId})`);
  await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at,scan_run_id) VALUES (${jobId},${input.tenantId},'comprehensive_scanner',${input.passportId},'osv_manifest_scan','Pending',0,NOW(),NOW(),NOW(),${runId})`);
  await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${jobId},'comprehensive_scanner',${`Queued OSV dependency vulnerability scan against the persisted SBOM (scan ${runId}).`},'Info')`);
  return { scanRunId: runId, scanId, jobId };
}
