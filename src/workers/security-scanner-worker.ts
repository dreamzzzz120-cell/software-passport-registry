import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { Pool } from 'pg';
import { downloadArchive, generateRepositorySbom, runBounded, validateArchiveEntries } from './osv-worker.ts';
import { createWorkerPool, assertWorkerDatabase } from './worker-db.ts';
import { runRealRepositoryScanners } from '../scanners/real-repository-scanners.ts';

const WORKER_ID = `${os.hostname()}:${process.pid}:security`;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const JOB_LEASE_MINUTES = 10;

async function claimJob(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT id, tenant_id, passport_id, attempt_count, max_attempts FROM agent_jobs WHERE job_type='repository_security_scan' AND attempt_count < max_attempts AND ((status='Pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())) OR (status='Running' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '${JOB_LEASE_MINUTES} minutes')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    const job = result.rows[0];
    if (!job) { await client.query('COMMIT'); return null; }
    const updated = await client.query(`UPDATE agent_jobs SET status='Running', progress=5, attempt_count=attempt_count+1, locked_at=NOW(), locked_by=$2, updated_at=NOW() WHERE id=$1 AND tenant_id=$3 RETURNING id, tenant_id, passport_id, attempt_count, max_attempts`, [job.id, WORKER_ID, job.tenant_id]);
    await client.query('COMMIT');
    const claimed = updated.rows[0];
    return claimed ? { ...claimed, attempt_count: Number(claimed.attempt_count) } : null;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function processSecurityJob(pool: Pool, job: any) {
  const source = (await pool.query('SELECT * FROM repository_scan_sources WHERE job_id=$1 AND tenant_id=$2', [job.id, job.tenant_id])).rows[0];
  if (!source) throw new Error('REPOSITORY_CONNECTION_NOT_FOUND');
  const connection = (await pool.query(`SELECT id FROM repository_connections WHERE id=$1 AND tenant_id=$2 AND provider='github' AND access_mode='public' AND status='Active'`, [source.connection_id, job.tenant_id])).rows[0];
  if (!connection) throw new Error('REPOSITORY_CONNECTION_NOT_FOUND');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `spr-sec-${job.id}-`));
  try {
    const requestedRef = source.requested_ref || 'main';
    const repoApi = `https://api.github.com/repos/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}`;
    const metadataResponse = await fetch(repoApi, { redirect: 'error', headers: { accept: 'application/vnd.github+json', 'user-agent': 'spr-security-worker/1.0' } });
    if (!metadataResponse.ok) throw new Error(metadataResponse.status === 404 ? 'REPOSITORY_NOT_FOUND' : 'REPOSITORY_ACCESS_DENIED');
    const metadata: any = await metadataResponse.json();
    if (metadata.private) throw new Error('REPOSITORY_ACCESS_DENIED');
    const commitResponse = await fetch(`${repoApi}/commits/${encodeURIComponent(requestedRef)}`, { redirect: 'error', headers: { accept: 'application/vnd.github+json', 'user-agent': 'spr-security-worker/1.0' } });
    if (!commitResponse.ok) throw new Error('REPOSITORY_REF_NOT_FOUND');
    const commit: any = await commitResponse.json();
    if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('REPOSITORY_REF_NOT_FOUND');

    const archivePath = path.join(tempRoot, 'repository.zip');
    const extractPath = path.join(tempRoot, 'extracted');
    await mkdir(extractPath);
    await downloadArchive(`https://codeload.github.com/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}/zip/${commit.sha}`, archivePath, { maxBytes: MAX_ARCHIVE_BYTES });
    const archiveExecutable = process.platform === 'win32' ? 'tar.exe' : 'unzip';
    const listing = await runBounded(archiveExecutable, process.platform === 'win32' ? ['-tf', archivePath] : ['-Z1', archivePath], 30_000, 10 * 1024 * 1024);
    if (listing.code !== 0) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    validateArchiveEntries(listing.stdout.toString('utf8').split(/\r?\n/).filter(Boolean));
    const extraction = await runBounded(archiveExecutable, process.platform === 'win32' ? ['-xf', archivePath, '-C', extractPath] : ['-q', archivePath, '-d', extractPath], 30_000);
    if (extraction.code !== 0) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const roots = await readdir(extractPath, { withFileTypes: true });
    const archiveRoot = roots.find(entry => entry.isDirectory());
    if (!archiveRoot) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const repositoryRoot = path.join(extractPath, archiveRoot.name);
    const scanRoot = source.repository_subdirectory ? path.resolve(repositoryRoot, source.repository_subdirectory) : repositoryRoot;
    if (!scanRoot.startsWith(path.resolve(repositoryRoot) + path.sep) && scanRoot !== path.resolve(repositoryRoot)) throw new Error('REPOSITORY_PATH_INVALID');

    await pool.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,$2,$3,'Info')`, [job.id, 'security-scanner', `Acquired GitHub commit ${commit.sha}`]);
    await pool.query(`UPDATE agent_jobs SET progress=25,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='Running' AND locked_by=$3`, [job.id, job.tenant_id, WORKER_ID]);

    const generated = await generateRepositorySbom(scanRoot, process.env.SYFT_PATH || 'syft');
    await pool.query(`UPDATE agent_jobs SET progress=55,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='Running' AND locked_by=$3`, [job.id, job.tenant_id, WORKER_ID]);
    const scanned = await runRealRepositoryScanners(scanRoot, generated.document);
    const findings = scanned.findings;

    for (const finding of findings) {
      const findingKey = sha256(`${job.tenant_id}|${job.id}|${finding.engineId}|${finding.category}|${finding.title}|${finding.component || ''}`);
      await pool.query(`INSERT INTO scan_findings (id,tenant_id,asset_id,job_id,severity,category,title,description,component,status,detected_at,engine_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Open',NOW(),$10) ON CONFLICT DO NOTHING`, [`finding-${findingKey}`, job.tenant_id, job.passport_id, job.id, finding.severity, finding.category, finding.title, finding.description, finding.component || null, finding.engineId]);
    }

    const evidencePayload = JSON.stringify({ repository: `${source.repository_owner}/${source.repository_name}`, requestedRef, resolvedCommitSha: commit.sha, engines: ['Syft','OSV','spr-secret-scanner-v1','spr-iac-config-scanner-v1','spr-license-scanner-v1'], findingCount: findings.length, limitations: ['OSV results are provider observations, not cryptographic verification.','Secret/config rules are deterministic pattern scanners and can produce false positives/negatives.'] });
    const evidenceHash = sha256(evidencePayload);
    await pool.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,status,signer,timestamp,hash,raw_content,engine_id) VALUES ($1,$2,$3,'Multi-engine repository security scan','Security Scan',0,'OBSERVED','SPR scanner',NOW(),$4,$5,'spr-security-orchestrator-v1') ON CONFLICT DO NOTHING`, [`ev-security-${job.id}-${evidenceHash.slice(0,24)}`, job.tenant_id, job.passport_id, `sha256:${evidenceHash}`, evidencePayload]);
    await pool.query(`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name) VALUES ($1,$2,$3,'Multi-engine repository security scan',$4,'Completed',0,$5,NOW(),$6) ON CONFLICT DO NOTHING`, [`scan-security-${job.id}-${commit.sha.slice(0,16)}`, job.tenant_id, `${source.repository_owner}/${source.repository_name}@${commit.sha.slice(0,12)}`, WORKER_ID, findings.length, source.repository_owner]);
    const completed = await pool.query(`UPDATE agent_jobs SET status='Completed',progress=100,result=$2,error=NULL,completed_at=NOW(),locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1 AND tenant_id=$3 AND status='Running' AND locked_by=$4 RETURNING id`, [job.id, JSON.stringify({ engines: ['Syft','OSV','Secret','IaC/Config','License'], findings: findings.length, commitSha: commit.sha, evidenceHash: `sha256:${evidenceHash}` }), job.tenant_id, WORKER_ID]);
    if (completed.rowCount !== 1) throw new Error('JOB_LEASE_LOST');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function fail(pool: Pool, job: any, error: unknown) {
  const code = error instanceof Error ? error.message : 'SCAN_WORKER_ERROR';
  const retry = Number(job.attempt_count) < Number(job.max_attempts);
  const nextStatus = retry ? 'Pending' : 'Failed';
  const nextAttemptAt = retry ? new Date(Date.now() + 30_000).toISOString() : null;
  const result = await pool.query(`UPDATE agent_jobs SET status=$2,progress=CASE WHEN $2='Failed' THEN 100 ELSE progress END,error=$3,next_attempt_at=$4,locked_at=NULL,locked_by=NULL,completed_at=CASE WHEN $2='Failed' THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=$1 AND tenant_id=$5 AND status='Running' AND locked_by=$6 RETURNING id`, [job.id, nextStatus, code.slice(0,200), nextAttemptAt, job.tenant_id, WORKER_ID]);
  if (result.rowCount === 1) {
    await pool.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,'security-scanner',$2,$3)`, [job.id, retry ? `Scan failed; retry scheduled: ${code.slice(0,180)}` : `Scan permanently failed: ${code.slice(0,180)}`, retry ? 'Warning' : 'Error']);
  }
}

export async function runSecurityScannerOnce(pool: Pool) {
  const job = await claimJob(pool);
  if (!job) return false;
  try { await processSecurityJob(pool, job); } catch (error) { await fail(pool, job, error); }
  return true;
}

export async function runSecurityScannerLoop() {
  const pool = createWorkerPool();
  await assertWorkerDatabase(pool);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(JSON.stringify({ event: 'security_scanner_started', workerId: WORKER_ID }));
  try { while (!stopping) { const processed = await runSecurityScannerOnce(pool); if (!processed) await new Promise(resolve => setTimeout(resolve, 2000)); } }
  finally { await pool.end(); }
}
