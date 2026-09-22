/**
 * The single way a scan enters the system. Every submission -- an
 * authenticated customer's repository or upload, a scheduled re-scan, an
 * anonymous Free Review -- creates the same rows here: the durable scans row
 * (the root every job, file, finding and evidence record points at through
 * scan_id), the worker jobs that will process it, and their sources. A scan
 * therefore has a persistent, queryable identity before any worker has
 * touched it, and it keeps that identity whatever happens afterwards.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { newScanId } from './scan-ledger.ts';

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

// Defense-in-depth: every repository scan, including authenticated/internal callers,
// must enter the GitHub acquisition pipeline with path-safe identifiers. The public
// route validates these fields too, but the queue boundary is the security boundary
// that prevents a future caller from bypassing that validation.
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_REF = /^[^\u0000-\u001f\u007f]{1,200}$/;
const SAFE_SUBDIRECTORY = /^(?:[^\u0000-\u001f\u007f\\]*\/)*[^\u0000-\u001f\u007f\\]*$/;

function assertRepositorySubmission(input: RepositorySubmission): void {
  if (!GITHUB_NAME.test(input.owner) || !GITHUB_NAME.test(input.repository)) {
    throw new Error('REPOSITORY_INPUT_INVALID');
  }
  if (input.ref !== null && !GITHUB_REF.test(input.ref)) {
    throw new Error('REPOSITORY_REF_INVALID');
  }
  if (!SAFE_SUBDIRECTORY.test(input.subdirectory) || input.subdirectory.length > 500) {
    throw new Error('REPOSITORY_SUBDIRECTORY_INVALID');
  }
}

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

export interface SubmittedScan { scanId: string; repositoryJobId: string; securityJobId: string }

export async function enqueueRepositoryScan(db: ScopedDb, input: RepositorySubmission): Promise<SubmittedScan> {
  assertRepositorySubmission(input);
  const existingConnection = (await db.execute(sql`SELECT id FROM repository_connections WHERE tenant_id=${input.tenantId} AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`) as any).rows?.[0];
  const connectionId = existingConnection?.id || id('repo');
  if (!existingConnection) await db.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${input.tenantId},'github','public-github',${input.connectionLabel ?? 'Public GitHub acquisition'},'public','Active')`);
  const scanId = newScanId();
  const repositoryJobId = id('job');
  const securityJobId = id('job');
  const sourceRef = `${input.owner}/${input.repository}@${input.ref ?? 'default'}${input.subdirectory ? `:${input.subdirectory}` : ''}`;
  const now = new Date().toISOString();
  await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,software_identity,source,source_ref,declared_scope,job_id,worker_job_id,coverage_state,passport_id,client_id,created_at,updated_at) VALUES (${scanId},${input.tenantId},${input.targetName},${input.scanType ?? 'Repository scan'},${input.triggeredBy},'Queued',0,NULL,${now},${input.clientName},${`${input.owner}/${input.repository}`},'github',${sourceRef},${input.subdirectory || ''},${repositoryJobId},${securityJobId},'unknown',${input.passportId},${input.clientId},NOW(),NOW())`);
  await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at,scan_id) VALUES (${repositoryJobId},${input.tenantId},'repository-scanner',${input.passportId},'repository_scan','Pending',0,NOW(),NOW(),NOW(),${scanId}),(${securityJobId},${input.tenantId},'security-scanner',${input.passportId},'repository_security_scan','Pending',0,NOW(),NOW(),NOW(),${scanId})`);
  await db.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${input.tenantId},${connectionId},'github',${input.owner},${input.repository},${input.ref},${input.subdirectory},NOW()),(${id('source')},${securityJobId},${input.tenantId},${connectionId},'github',${input.owner},${input.repository},${input.ref},${input.subdirectory},NOW())`);
  await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${repositoryJobId},'repository-scanner',${`Queued GitHub acquisition + file inventory + pinned Syft SBOM + OSV dependency scan (scan ${scanId}).`},'Info'),(${securityJobId},'security-scanner',${`Queued file inventory + secret, IaC/configuration, license, Syft and OSV scan (scan ${scanId}).`},'Info')`);
  return { scanId, repositoryJobId, securityJobId };
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

export async function enqueueUploadScan(db: ScopedDb, input: UploadSubmission): Promise<{ scanId: string; intakeJobId: string }> {
  const scanId = newScanId();
  const intakeJobId = id('job');
  const now = new Date().toISOString();
  await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,software_identity,source,source_ref,declared_scope,intake_job_id,intake_session_id,coverage_state,passport_id,client_id,created_at,updated_at) VALUES (${scanId},${input.tenantId},${input.targetName},'Uploaded files scan',${input.triggeredBy},'Queued',0,NULL,${now},${input.clientName},${input.targetName},'upload',${`intake:${input.sessionId}`},'',${intakeJobId},${input.sessionId},'unknown',${input.passportId},${input.clientId},NOW(),NOW())`);
  await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at,scan_id) VALUES (${intakeJobId},${input.tenantId},'intake-scanner',${input.passportId},'intake_scan','Pending',0,NOW(),NOW(),NOW(),${scanId})`);
  await db.execute(sql`INSERT INTO intake_scan_sources (id,job_id,scan_id,tenant_id,session_id,item_count,created_at) VALUES (${id('source')},${intakeJobId},${scanId},${input.tenantId},${input.sessionId},${input.itemCount},NOW())`);
  await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${intakeJobId},'intake-scanner',${`Queued uploaded-file inventory, archive enumeration, Syft SBOM, OSV and content scan over ${input.itemCount} uploaded item(s) (scan ${scanId}).`},'Info')`);
  return { scanId, intakeJobId };
}

export interface SbomSubmission { tenantId: string; clientId: string | null; passportId: string; triggeredBy: string; targetName: string; clientName: string; scanType: string }

/** An OSV query over the passport's persisted SBOM. No files are involved, so no inventory is produced -- the scan row says so. */
export async function enqueueSbomScan(db: ScopedDb, input: SbomSubmission): Promise<{ scanId: string; jobId: string }> {
  const scanId = newScanId();
  const jobId = id('job');
  const now = new Date().toISOString();
  await db.execute(sql`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,software_identity,source,source_ref,declared_scope,job_id,coverage_state,passport_id,client_id,created_at,updated_at) VALUES (${scanId},${input.tenantId},${input.targetName},${input.scanType},${input.triggeredBy},'Queued',0,NULL,${now},${input.clientName},${input.targetName},'sbom',${`passport:${input.passportId}`},'',${jobId},'no_inventory',${input.passportId},${input.clientId},NOW(),NOW())`);
  await db.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at,scan_id) VALUES (${jobId},${input.tenantId},'comprehensive_scanner',${input.passportId},'osv_manifest_scan','Pending',0,NOW(),NOW(),NOW(),${scanId})`);
  await db.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${jobId},'comprehensive_scanner',${`Queued OSV dependency vulnerability scan against the persisted SBOM (scan ${scanId}).`},'Info')`);
  return { scanId, jobId };
}
