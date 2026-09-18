import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readdir, rm, readFile, lstat } from 'node:fs/promises';
import { Pool } from 'pg';
import { downloadArchive, fetchGitHubApi, generateRepositorySbom, githubHeaders, isRateLimited, resolveTenantGitHubToken, rootErrorMessage, runBounded, validateArchiveEntries } from './osv-worker.ts';
import { createWorkerPool, assertWorkerDatabase } from './worker-db.ts';
import { runRealRepositoryScanners } from '../scanners/real-repository-scanners.ts';
import { calculateAndStoreTrustScore } from '../utils/scanner.ts';
import { scanFindingIdentity } from '../security/scan-finding-identity.ts';
import { decryptCredentials } from '../integrations/credential-vault.ts';
import { credentialsFrom, onScanCompleted } from '../integrations/connectwise/scan-completion-hook.ts';

const WORKER_ID = `${os.hostname()}:${process.pid}:security`;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

function fileClassification(filePath: string): { category: string; method: string } {
  const name = path.basename(filePath).toLowerCase();
  const p = filePath.toLowerCase();
  if (/\\.(zip|tar|tgz|tar\\.gz|tar\\.bz2|tar\\.xz)$/.test(name)) return { category: 'archive', method: 'extension' };
  if (/(^|[\/])(package-lock\\.json|npm-shrinkwrap\\.json|yarn\\.lock|pnpm-lock\\.yaml|poetry\\.lock|composer\\.lock|gemfile\\.lock|cargo\\.lock|go\\.sum)$/.test(p)) return { category: 'lockfile', method: 'filename' };
  if (/(^|[\/])(package\\.json|requirements(?:\\.txt)?|pyproject\\.toml|poetry\\.toml|cargo\\.toml|go\\.mod|pom\\.xml|composer\\.json|gemfile)$/.test(p)) return { category: 'dependency manifest', method: 'filename' };
  if (/sbom|cyclonedx|spdx/.test(name)) return { category: 'sbom', method: 'filename' };
  if (/(^|[\/])(\\.github\/|jenkinsfile|azure-pipelines|bitbucket-pipelines|gitlab-ci)/.test(p)) return { category: 'ci/cd', method: 'path' };
  if (/terraform|\\.tf$|\\.tfvars$|dockerfile|kustomization|helm/.test(p)) return { category: 'infrastructure', method: 'filename' };
  if (/\\.(js|jsx|ts|tsx|py|rb|go|rs|java|kt|kts|cs|php|c|cc|cpp|h|hpp|swift|scala|sh|bash|zsh|ps1|sql)$/.test(name)) return { category: /test|spec/.test(name) ? 'test' : 'source code', method: 'extension' };
  if (/\\.(ya?ml|json|toml|ini|conf|cfg|env|properties|xml)$/.test(name)) return { category: 'configuration', method: 'extension' };
  if (/\\.(exe|dll|so|dylib|bin|elf|class|jar|war)$/.test(name)) return { category: 'binary', method: 'extension' };
  if (/\\.(deb|rpm|apk|msi|whl|gem|nupkg)$/.test(name)) return { category: 'package', method: 'extension' };
  if (/\\.(md|txt|rst|adoc|pdf|docx?)$/.test(name)) return { category: 'documentation', method: 'extension' };
  if (/(^|[\/])(license|copying|notice)(\\.|$)/.test(name)) return { category: 'license', method: 'filename' };
  return { category: 'unknown', method: 'no-confident-match' };
}

async function recordFileLedger(pool: Pool, job: any, scanRoot: string, _repositoryRoot: string, scannerVersion: string) {
  if (!job.scan_id) return { files: 0, bytes: 0 };
  const MAX_FILES = 50_000;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const files: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        files.push(full);
        continue;
      }
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile()) continue;
      files.push(full);
      if (files.length > MAX_FILES) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
    }
  }
  await walk(scanRoot);
  let totalBytes = 0;
  for (const full of files) {
    const stat = await lstat(full);
    const relative = path.relative(scanRoot, full).split(path.sep).join('/');
    const classification = fileClassification(relative);
    const isSymlink = stat.isSymbolicLink();
    totalBytes += stat.size;
    let hash: string | null = null;
    let disposition = 'INSPECTED';
    let inspection = 'inspected';
    let failure: string | null = null;
    let applicable = classification.category !== 'unknown';
    if (isSymlink) {
      disposition = 'INACCESSIBLE'; inspection = 'inaccessible'; failure = 'SYMLINK_NOT_FOLLOWED'; applicable = false;
    } else if (stat.size === 0) {
      disposition = 'SKIPPED'; inspection = 'skipped'; failure = 'EMPTY_FILE'; applicable = false;
    } else if (stat.size > MAX_FILE_BYTES) {
      disposition = 'PARTIAL'; inspection = 'partial'; failure = 'FILE_TOO_LARGE_FOR_CONTENT_INSPECTION';
    } else {
      try { hash = sha256(await readFile(full)); }
      catch { disposition = 'INACCESSIBLE'; inspection = 'inaccessible'; failure = 'FILE_READ_FAILED'; applicable = false; }
    }
    await pool.query(
      `INSERT INTO scan_file_ledger
        (id,scan_id,tenant_id,client_id,software_identity,parent_archive_id,path,filename,size_bytes,sha256,detected_type,category,inspection_status,analysis_status,scanner_tool,scanner_version,error_reason,disposition_status,failure_stage,classification_method,is_archive,archive_depth,applicable_to_analysis,evidence_status)
       VALUES ($1,$2,$3,NULL,$4,NULL,$5,$6,$7,$8,$9,$10,$11,'not_analyzed',$12,$13,$14,$15,$16,$17,$18,$19,'none')
       ON CONFLICT (scan_id,path) DO UPDATE SET
         size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,detected_type=EXCLUDED.detected_type,category=EXCLUDED.category,
         inspection_status=EXCLUDED.inspection_status,scanner_tool=EXCLUDED.scanner_tool,scanner_version=EXCLUDED.scanner_version,
         error_reason=EXCLUDED.error_reason,disposition_status=EXCLUDED.disposition_status,failure_stage=EXCLUDED.failure_stage,
         classification_method=EXCLUDED.classification_method,is_archive=EXCLUDED.is_archive,applicable_to_analysis=EXCLUDED.applicable_to_analysis`,
      [
        `file-${sha256(job.scan_id+'|'+relative).slice(0,48)}`, job.scan_id, job.tenant_id,
        job.passport_id, relative, path.basename(full), stat.size, hash, 'filesystem',
        classification.category, inspection, scannerVersion, failure, disposition,
        failure ? 'inventory' : '', classification.method, classification.category === 'archive', 0, applicable,
      ],
    );
  }
  return { files: files.length, bytes: totalBytes };
}
const JOB_LEASE_MS = 10 * 60 * 1000;

async function recoverStaleJobs(pool: Pool) {
  await pool.query(`UPDATE agent_jobs SET status=CASE WHEN attempt_count < max_attempts THEN 'Pending' ELSE 'Failed' END, error=CASE WHEN attempt_count < max_attempts THEN NULL ELSE 'SECURITY_SCAN_LEASE_EXPIRED' END, next_attempt_at=CASE WHEN attempt_count < max_attempts THEN NOW() ELSE next_attempt_at END, locked_at=NULL, locked_by=NULL, updated_at=NOW(), completed_at=CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE completed_at END WHERE job_type='repository_security_scan' AND status='Running' AND locked_at < NOW() - ($1 * INTERVAL '1 millisecond')`, [JOB_LEASE_MS]);
}

async function claimJob(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE agent_jobs SET status=CASE WHEN attempt_count < max_attempts THEN 'Pending' ELSE 'Failed' END, error=CASE WHEN attempt_count < max_attempts THEN NULL ELSE 'SECURITY_SCAN_LEASE_EXPIRED' END, next_attempt_at=CASE WHEN attempt_count < max_attempts THEN NOW() ELSE next_attempt_at END, locked_at=NULL, locked_by=NULL, updated_at=NOW(), completed_at=CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE completed_at END WHERE job_type='repository_security_scan' AND status='Running' AND locked_at < NOW() - ($1 * INTERVAL '1 millisecond')`, [JOB_LEASE_MS]);
    const result = await client.query(`SELECT id, tenant_id, passport_id, scan_id, attempt_count, max_attempts FROM agent_jobs WHERE status='Pending' AND job_type='repository_security_scan' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    const job = result.rows[0];
    if (!job) { await client.query('COMMIT'); return null; }
    await client.query(`UPDATE agent_jobs SET status='Running', progress=5, attempt_count=attempt_count+1, locked_at=NOW(), locked_by=$2, updated_at=NOW() WHERE id=$1 AND tenant_id=$3`, [job.id, WORKER_ID, job.tenant_id]);
    await client.query('COMMIT');
    return { ...job, attempt_count: Number(job.attempt_count) + 1 };
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
    const repoApi = `https://api.github.com/repos/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}`;
    const tenantToken = await resolveTenantGitHubToken(pool, job.tenant_id);
    const headers = (extra: Record<string, string>) => tenantToken ? githubHeaders(extra, tenantToken) : githubHeaders(extra);
    const metadataResponse = await fetchGitHubApi(repoApi, { headers: headers({ accept: 'application/vnd.github+json', 'user-agent': 'spr-security-worker/1.0' }) });
    if (isRateLimited(metadataResponse)) throw new Error('REPOSITORY_RATE_LIMITED');
    if (!metadataResponse.ok) throw new Error(metadataResponse.status === 404 ? 'REPOSITORY_NOT_FOUND' : 'REPOSITORY_ACCESS_DENIED');
    const metadata: any = await metadataResponse.json();
    if (metadata.private && !tenantToken) throw new Error('REPOSITORY_PRIVATE_REQUIRES_CREDENTIAL');
    const defaultBranch = typeof metadata.default_branch === 'string' && metadata.default_branch.trim() ? metadata.default_branch.trim() : '';
    const requestedRef = source.requested_ref || defaultBranch || 'main';
    // Renamed/transferred repositories: use the canonical name GitHub reports.
    const canonicalOwner = typeof metadata.owner?.login === 'string' && metadata.owner.login ? metadata.owner.login : source.repository_owner;
    const canonicalName = typeof metadata.name === 'string' && metadata.name ? metadata.name : source.repository_name;
    const canonicalRepoApi = `https://api.github.com/repos/${encodeURIComponent(canonicalOwner)}/${encodeURIComponent(canonicalName)}`;
    const commitResponse = await fetchGitHubApi(`${canonicalRepoApi}/commits/${encodeURIComponent(requestedRef)}`, { headers: headers({ accept: 'application/vnd.github+json', 'user-agent': 'spr-security-worker/1.0' }) });
    if (isRateLimited(commitResponse)) throw new Error('REPOSITORY_RATE_LIMITED');
    if (!commitResponse.ok) throw new Error('REPOSITORY_REF_NOT_FOUND');
    const commit: any = await commitResponse.json();
    if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('REPOSITORY_REF_NOT_FOUND');

    const archivePath = path.join(tempRoot, 'repository.zip');
    const extractPath = path.join(tempRoot, 'extracted');
    await mkdir(extractPath);
    await downloadArchive(`https://codeload.github.com/${encodeURIComponent(canonicalOwner)}/${encodeURIComponent(canonicalName)}/zip/${commit.sha}`, archivePath, { maxBytes: MAX_ARCHIVE_BYTES, ...(tenantToken ? { token: tenantToken } : {}) });
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

    const inventory = await recordFileLedger(pool, job, scanRoot, repositoryRoot, 'security-scanner-v1');
    await pool.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,$2,$3,'Info')`, [job.id, 'security-scanner', `Acquired GitHub commit ${commit.sha}; inventoried ${inventory.files} files (${inventory.bytes} bytes).`]);
    await pool.query(`UPDATE agent_jobs SET progress=25,updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [job.id, job.tenant_id]);
    const generated = await generateRepositorySbom(scanRoot, process.env.SYFT_PATH || 'syft');
    await pool.query(`UPDATE agent_jobs SET progress=55,updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [job.id, job.tenant_id]);
    const scanned = await runRealRepositoryScanners(scanRoot, generated.document);
    const findings = scanned.findings;
    for (const finding of findings) {
      const findingKey = sha256(scanFindingIdentity({ tenantId: job.tenant_id, passportId: job.passport_id, engineId: finding.engineId, category: finding.category, title: finding.title, component: finding.component }));
      await pool.query(`INSERT INTO scan_findings (id,tenant_id,asset_id,job_id,scan_id,severity,category,title,description,component,status,detected_at,engine_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Open',NOW(),$11) ON CONFLICT DO NOTHING`, [`finding-${findingKey}`, job.tenant_id, job.passport_id, job.id, job.scan_id, finding.severity, finding.category, finding.title, finding.description, finding.component || null, finding.engineId]);
    }
    const evidencePayload = JSON.stringify({ repository: `${source.repository_owner}/${source.repository_name}`, requestedRef, resolvedCommitSha: commit.sha, engines: ['Syft','OSV','spr-secret-scanner-v1','spr-iac-config-scanner-v1','spr-license-scanner-v1'], findingCount: findings.length, limitations: ['OSV results are provider observations, not cryptographic verification.','Secret/config rules are deterministic pattern scanners and can produce false positives/negatives.'] });
    const evidenceHash = sha256(evidencePayload);
    await pool.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,scan_id,job_id,name,type,verified,status,signer,timestamp,hash,raw_content,engine_id) VALUES ($1,$2,$3,$4,$5,'Multi-engine repository security scan','Security Scan',0,'OBSERVED','SPR scanner',NOW(),$6,$7,'spr-security-orchestrator-v1') ON CONFLICT DO NOTHING`, [`ev-security-${job.id}-${evidenceHash.slice(0,24)}`, job.tenant_id, job.passport_id, job.scan_id, job.id, `sha256:${evidenceHash}`, evidencePayload]);
    if (job.scan_id) await pool.query(`UPDATE scans SET target_name=$2, status='Completed', completed_at=NOW(), duration_ms=GREATEST(0, EXTRACT(EPOCH FROM (NOW()-created_at))::integer*1000), findings_count=$3, scanner_name='spr-security-orchestrator-v1', scanner_version=$4, coverage_state='inventory_complete_analysis_partial', error_state=NULL, error_code=NULL WHERE id=$1 AND tenant_id=$5`, [job.scan_id, `${source.repository_owner}/${source.repository_name}@${commit.sha.slice(0,12)}`, findings.length, 'security-scanner-v1', job.tenant_id]);
    await pool.query(`UPDATE agent_jobs SET status='Completed',progress=100,result=$2,error=NULL,completed_at=NOW(),locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1 AND tenant_id=$3 AND status='Running' AND locked_by=$4`, [job.id, JSON.stringify({ engines: ['Syft','OSV','Secret','IaC/Config','License'], findings: findings.length, commitSha: commit.sha, evidenceHash: `sha256:${evidenceHash}` }), job.tenant_id, WORKER_ID]);
    // Same reason as osv-worker.scorePassportAfterScan: the passport's score and
    // verification_status are outcomes of this scan and were never recomputed.
    try {
      const score = await calculateAndStoreTrustScore(job.passport_id, job.tenant_id, { pool });
      console.info(JSON.stringify({ event: 'passport_scored', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, passportId: job.passport_id, verificationStatus: score.verificationStatus, overallScore: score.overallScore, evidenceCompleteness: score.evidenceCompleteness, evidenceCount: score.evidenceCount, findingsCount: score.findingsCount }));
    } catch (error) {
      const reason = safeFailureReason(rootErrorMessage(error));
      if (job.scan_id) {
        await pool.query(`UPDATE scans SET coverage_state='complete_passport_update_failed', error_state='passport_update_failed', error_code='PASSPORT_SCORE_PERSIST_FAILED', completed_at=COALESCE(completed_at,NOW()) WHERE id=$1 AND tenant_id=$2`, [job.scan_id, job.tenant_id]).catch(() => undefined);
      }
      console.error(JSON.stringify({ event: 'passport_score_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, passportId: job.passport_id, scanId: job.scan_id, reason: safeFailureReason(rootErrorMessage(error)) }));
    }
    await produceConnectWiseTickets(pool, job);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}

async function produceConnectWiseTickets(pool: Pool, job: any): Promise<void> {
  try {
    const stored = await pool.query(`SELECT encrypted_payload FROM integration_credentials WHERE tenant_id = $1 AND provider = 'connectwise' AND status = 'CONFIGURED' LIMIT 1`, [job.tenant_id]);
    const payload = stored.rows[0]?.encrypted_payload;
    if (!payload) return;
    const credentials = credentialsFrom(decryptCredentials(payload) as Record<string, unknown>);
    if (!credentials) { console.warn(`[SecurityScanner] ConnectWise credentials for tenant ${job.tenant_id} are incomplete; no tickets filed.`); return; }
    const result = await onScanCompleted({ query: (text, params) => pool.query(text, params as any[]).then((r) => ({ rows: r.rows })), tenantId: job.tenant_id, jobId: job.id, credentials });
    if (result.produced > 0) console.info(`[SecurityScanner] Filed ${result.produced}/${result.attempted} ConnectWise tickets for job ${job.id}.`);
  } catch (error) { console.error('[SecurityScanner] ConnectWise ticket production failed:', error instanceof Error ? error.message : String(error)); }
}

function safeFailureReason(raw: string): string {
  return raw.replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '[REDACTED_TOKEN]').replace(/(authorization|bearer|token|key|secret)[=: ]+\S+/gi, '$1 [REDACTED]').replace(/https?:\/\/[^@\s]*@/g, 'https://[REDACTED]@').slice(0, 200);
}

const DETERMINISTIC_TERMINAL_ERRORS = new Set(['SBOM_INVALID','SBOM_EMPTY','SBOM_MALFORMED','NO_SUPPORTED_MANIFESTS','REPOSITORY_TOO_LARGE','REPOSITORY_FILE_LIMIT_EXCEEDED','REPOSITORY_PATH_INVALID']);

async function fail(pool: Pool, job: any, error: unknown) {
  const code = error instanceof Error ? error.message : 'SCAN_WORKER_ERROR';
  const attempt = Number(job.attempt_count);
  const deterministicTerminal = DETERMINISTIC_TERMINAL_ERRORS.has(code);
  const retry = !deterministicTerminal && attempt < Number(job.max_attempts);
  const next = retry ? Math.min(60 * Math.pow(2, Math.max(0, attempt - 1)), 3600) : 0;
  console.error(JSON.stringify({ event: 'security_scan_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, attempt, maxAttempts: Number(job.max_attempts), willRetry: retry, terminal: deterministicTerminal, reason: safeFailureReason(code) }));
  await pool.query(`UPDATE agent_jobs SET status=$2,progress=CASE WHEN $2='Failed' THEN 100 ELSE progress END,error=$3,next_attempt_at=CASE WHEN $2='Pending' THEN NOW()+($4 * INTERVAL '1 second') ELSE next_attempt_at END,locked_at=NULL,locked_by=NULL,completed_at=CASE WHEN $2='Failed' THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=$1 AND tenant_id=$5 AND locked_by=$6`, [job.id, retry ? 'Pending' : 'Failed', code.slice(0,200), next, job.tenant_id, WORKER_ID]);
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
  console.log(JSON.stringify({ event: 'security_scanner_started', workerId: WORKER_ID, leaseMs: JOB_LEASE_MS }));
  try { while (!stopping) { await recoverStaleJobs(pool); const processed = await runSecurityScannerOnce(pool); if (!processed) await new Promise(resolve => setTimeout(resolve, 2000)); } }
  finally { await pool.end(); }
}