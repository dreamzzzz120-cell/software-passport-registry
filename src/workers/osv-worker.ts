import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Pool, PoolClient } from 'pg';
import { assessOsvSeverity } from '../security/osv-severity.ts';
import { componentIdentity, vulnerabilityIdentity } from '../security/osv-identity.ts';
import { normalizeCycloneDxComponentNames } from '../security/component-path-normalization.ts';
// This worker used to carry its own pool factory that read DATABASE_URL -- the
// owner role, which bypasses RLS -- and duplicated the TLS logic every other
// worker gets from worker-db.ts. Divergence between those two copies is what
// produced the 2026-08-31 outage. It now shares the single factory, so it
// connects as the least-privileged spr_worker_runtime role (via
// WORKER_DATABASE_URL) and there is exactly one TLS implementation to keep
// correct. Cross-tenant reads still work: migration 0048 gives that role an
// explicit spr_worker_cross_tenant policy on every tenant-scoped table, which
// is what the job queue needs and what BYPASSRLS used to provide.
import { createWorkerPool } from './worker-db.ts';

type ClaimedJob = {
  id: string;
  tenant_id: string;
  passport_id: string;
  attempt_count: number;
  max_attempts: number;
  job_type: string;
};

type SbomComponent = { name?: string; version?: string; ecosystem?: string };

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const PROVIDER_TIMEOUT_MS = 15_000;
const PROVIDER_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const JOB_LEASE_MS = 10 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_COUNT = 50_000;
const ACQUISITION_TIMEOUT_MS = 30_000;
const SBOM_TIMEOUT_MS = 120_000;
const SYFT_VERSION = '1.49.0';
const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_CODELOAD_ORIGIN = 'https://codeload.github.com';
const OSV_ORIGIN = 'https://api.osv.dev';

async function claimJob(pool: Pool): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<ClaimedJob>(`
      SELECT id, tenant_id, passport_id, attempt_count, max_attempts, job_type
      FROM agent_jobs
      WHERE job_type IN ('osv_manifest_scan', 'repository_scan')
        AND (
          (status = 'Pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          OR
          (status = 'Running' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '10 minutes')
        )
        AND attempt_count < max_attempts
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const job = result.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }
    const updated = await client.query<ClaimedJob>(`
      UPDATE agent_jobs
      SET status = 'Running', progress = 10,
          attempt_count = attempt_count + 1,
          locked_at = NOW(), locked_by = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, tenant_id, passport_id, attempt_count, max_attempts, job_type
    `, [job.id, WORKER_ID]);
    await client.query('COMMIT');
    return updated.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

function assertTrustedOutboundUrl(raw: string, expectedOrigin: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.origin !== expectedOrigin || url.username || url.password) {
    throw new Error('OUTBOUND_URL_BLOCKED');
  }
  return url;
}

async function fetchOsv(component: Required<Pick<SbomComponent, 'name' | 'version'>> & SbomComponent) {
  const url = assertTrustedOutboundUrl(`${OSV_ORIGIN}/v1/query`, OSV_ORIGIN);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ package: { name: component.name, ecosystem: component.ecosystem || 'npm' }, version: component.version }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OSV_HTTP_${response.status}`);
    const text = await readTextLimited(response, PROVIDER_MAX_RESPONSE_BYTES);
    try {
      return { response: JSON.parse(text), raw: text };
    } catch {
      throw new Error('OSV_INVALID_RESPONSE');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function deterministicId(prefix: string, value: string) {
  return `${prefix}-${sha256(value).slice(0, 48)}`;
}

async function persistProviderResult(client: PoolClient, job: ClaimedJob, component: Required<Pick<SbomComponent, 'name' | 'version'>> & SbomComponent, providerResponse: unknown) {
  const receivedAt = new Date().toISOString();
  const responseHash = sha256(JSON.stringify(providerResponse));
  const evidenceKey = `${job.id}|${job.tenant_id}|${job.passport_id}|osv|${component.name}|${component.version}|${responseHash}`;
  const evidenceId = deterministicId('ev-osv', evidenceKey);
  const persistedPayload = JSON.stringify({ source: `${OSV_ORIGIN}/v1/query`, requestedComponent: component, receivedAt, response: providerResponse });
  const digest = `sha256:${sha256(persistedPayload)}`;
  await client.query(`
    INSERT INTO evidence_items
      (id, tenant_id, asset_id, name, type, verified, status, signer, timestamp, hash, raw_content, engine_id, verification_failure_reason)
    VALUES ($1, $2, $3, $4, 'Security Scan', 0, 'OBSERVED', 'api.osv.dev', $5, $6, $7, 'osv-worker', NULL)
    ON CONFLICT (id) DO NOTHING
  `, [evidenceId, job.tenant_id, job.passport_id, `OSV response for ${component.name}@${component.version}`, receivedAt, digest, persistedPayload]);

  const vulnerabilities = Array.isArray((providerResponse as any)?.vulns) ? (providerResponse as any).vulns : [];
  for (const vulnerability of vulnerabilities) {
    const aliases = Array.isArray(vulnerability?.aliases) ? vulnerability.aliases : [];
    const vulnerabilityId = String(vulnerability?.id || aliases[0] || 'OSV vulnerability').trim();
    const vulnKey = vulnerabilityIdentity({ tenantId: job.tenant_id, passportId: job.passport_id, vulnerabilityId, component });
    const assessment = assessOsvSeverity(vulnerability);
    const provenance = JSON.stringify({ source: 'api.osv.dev', vulnerabilityId, rationale: assessment.rationale, sourceSeverities: assessment.sourceSeverities, cvssScores: assessment.cvssScores, cvssVectors: assessment.cvssVectors });
    await client.query(`
      INSERT INTO scan_findings
        (id, tenant_id, asset_id, job_id, severity, category, title, description, component, status, detected_at, engine_id)
      VALUES ($1, $2, $3, $4, $5, 'Vulnerability', $6, $7, $8, 'Open', $9, 'osv-worker')
      ON CONFLICT (id) DO NOTHING
    `, [
      deterministicId('finding-osv', vulnKey), job.tenant_id, job.passport_id, job.id,
      assessment.severity, vulnerabilityId,
      `${vulnerability?.summary || aliases.join(', ') || 'OSV returned a vulnerability record.'} Severity provenance: ${provenance}`,
      `${component.name}@${component.version}`, receivedAt,
    ]);
  }
  return vulnerabilities.length;
}

async function processJob(pool: Pool, job: ClaimedJob) {
  const passport = (await pool.query('SELECT name, version, sbom FROM passports WHERE id = $1 AND tenant_id = $2', [job.passport_id, job.tenant_id])).rows[0];
  if (!passport) throw new Error('PASSPORT_NOT_FOUND');
  let parsed: unknown;
  try { parsed = JSON.parse(passport.sbom || '[]'); } catch { throw new Error('SBOM_MALFORMED'); }
  if (!Array.isArray(parsed)) throw new Error('SBOM_MALFORMED');
  const seenComponents = new Set<string>();
  const components = (parsed as SbomComponent[]).filter((component): component is Required<Pick<SbomComponent, 'name' | 'version'>> & SbomComponent => {
    if (typeof component?.name !== 'string' || !component.name.trim() || typeof component?.version !== 'string' || !component.version.trim()) return false;
    const identity = componentIdentity({ name: component.name, version: component.version, ecosystem: component.ecosystem });
    if (seenComponents.has(identity)) return false;
    seenComponents.add(identity);
    return true;
  });

  let findingCount = 0;
  for (const component of components) {
    const provider = await fetchOsv(component);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      findingCount += await persistProviderResult(client, job, component, provider.response);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  const completedAt = new Date().toISOString();
  if (components.length === 0) {
    const evidencePayload = JSON.stringify({
      source: 'SPR worker',
      passportId: job.passport_id,
      message: 'SBOM was present but contained no versioned components to query.',
      completedAt,
    });
    await pool.query(`
      INSERT INTO evidence_items
        (id, tenant_id, asset_id, name, type, verified, status, signer, timestamp, hash, raw_content, engine_id, verification_failure_reason)
      VALUES ($1, $2, $3, 'SBOM scan assessment', 'Security Scan', 0, 'OBSERVED', 'spr-worker', $4, $5, $6, 'osv-worker', 'SBOM_EMPTY')
      ON CONFLICT (id) DO NOTHING
    `, [
      deterministicId('ev-sbom-empty', `${job.id}|${job.tenant_id}|${job.passport_id}`),
      job.tenant_id,
      job.passport_id,
      completedAt,
      `sha256:${sha256(evidencePayload)}`,
      evidencePayload,
    ]);
  }
  await pool.query(`
    INSERT INTO scans (id, tenant_id, target_name, scan_type, triggered_by, status, duration_ms, findings_count, timestamp, client_name)
    VALUES ($1, $2, $3, 'OSV manifest component query', $4, 'Completed', 0, $5, $6, $7)
    ON CONFLICT (id) DO NOTHING
  `, [deterministicId('scan-osv', `${job.id}|${job.tenant_id}`), job.tenant_id, `${passport.name} ${passport.version}`, WORKER_ID, findingCount, completedAt, 'Persisted passport SBOM']);
  await pool.query(`
    UPDATE agent_jobs
    SET status = 'Completed', progress = 100, result = $2, error = NULL, completed_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE id = $1 AND tenant_id = $3 AND status = 'Running' AND locked_by = $4
  `, [job.id, JSON.stringify({ provider: 'OSV', evidenceState: 'Provider response persisted; not a cryptographic verification', componentsQueried: components.length, findingsPersisted: findingCount, completedAt }), job.tenant_id, WORKER_ID]);
}

const manifestNames = new Set(['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','requirements.txt','requirements-dev.txt','pyproject.toml','poetry.lock','Pipfile','Pipfile.lock','pom.xml','build.gradle','build.gradle.kts','gradle.lockfile','packages.lock.json','packages.config','go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','composer.json','composer.lock']);
const ignoredDirectories = new Set(['.git','node_modules','vendor','build','dist','.cache','__pycache__','.venv','venv','coverage','target']);

function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function fetchJson(url: string, notFoundCode: string) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (origin !== GITHUB_API_ORIGIN || parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('OUTBOUND_URL_BLOCKED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACQUISITION_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { redirect: 'error', headers: { accept: 'application/vnd.github+json', 'user-agent': 'spr-repository-worker/1.0' }, signal: controller.signal });
    if (response.status === 404 || response.status === 422) throw new Error(notFoundCode);
    if (response.status === 403) throw new Error('REPOSITORY_ACCESS_DENIED');
    if (!response.ok) throw new Error('REPOSITORY_ACCESS_DENIED');
    const text = await readTextLimited(response, PROVIDER_MAX_RESPONSE_BYTES);
    try { return JSON.parse(text); } catch { throw new Error('REPOSITORY_INVALID_RESPONSE'); }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('REPOSITORY_ACQUISITION_TIMEOUT');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function downloadArchive(url: string, destination: string, options: { timeoutMs?: number; maxBytes?: number } = {}) {
  const parsed = assertTrustedOutboundUrl(url, GITHUB_CODELOAD_ORIGIN);
  const timeoutMs = options.timeoutMs ?? ACQUISITION_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, { headers: { 'user-agent': 'spr-repository-worker/1.0' }, redirect: 'error', signal: controller.signal });
    if (response.status === 404) throw new Error('REPOSITORY_NOT_FOUND');
    if (response.status === 403) throw new Error('REPOSITORY_ACCESS_DENIED');
    if (!response.ok || !response.body) throw new Error('REPOSITORY_ACCESS_DENIED');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) throw new Error('REPOSITORY_TOO_LARGE');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body as any) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > maxBytes) throw new Error('REPOSITORY_TOO_LARGE');
      chunks.push(buffer);
    }
    await writeFile(destination, Buffer.concat(chunks));
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('REPOSITORY_ACQUISITION_TIMEOUT');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function runBounded(executable: string, args: string[], timeoutMs: number, outputLimit = 60 * 1024 * 1024) {
  return await new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore','pipe','pipe'] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutSize = 0; let settled = false;
    const finishReject = (error: Error) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(error); };
    const timer = setTimeout(() => finishReject(new Error(executable.toLowerCase().includes('syft') ? 'SBOM_GENERATION_TIMEOUT' : 'REPOSITORY_ACQUISITION_TIMEOUT')), timeoutMs);
    child.stdout.on('data', chunk => { if (settled) return; stdoutSize += chunk.length; if (stdoutSize > outputLimit) finishReject(new Error('SBOM_OUTPUT_TOO_LARGE')); else stdout.push(Buffer.from(chunk)); });
    child.stderr.on('data', chunk => { if (stderr.reduce((sum, value) => sum + value.length, 0) < 32_768) stderr.push(Buffer.from(chunk)); });
    child.on('error', () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(executable.toLowerCase().includes('syft') ? 'SBOM_GENERATOR_NOT_AVAILABLE' : 'REPOSITORY_ACQUISITION_FAILED')); });
    child.on('close', code => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') }); });
  });
}

export async function generateRepositorySbom(scanRoot: string, syftPath: string, options: { timeoutMs?: number; executableArgsPrefix?: string[] } = {}) {
  const prefix = options.executableArgsPrefix || [];
  const versionResult = await runBounded(syftPath, [...prefix,'version','-o','json'], 15_000, 1024 * 1024);
  if (versionResult.code !== 0 || !versionResult.stdout.toString('utf8').includes(SYFT_VERSION)) throw new Error('SBOM_GENERATOR_NOT_AVAILABLE');
  let result;
  try { result = await runBounded(syftPath, [...prefix,'scan',`dir:${scanRoot}`,'-o','cyclonedx-json'], options.timeoutMs ?? SBOM_TIMEOUT_MS); }
  catch (error: any) { if (error?.message === 'REPOSITORY_ACQUISITION_TIMEOUT') throw new Error('SBOM_GENERATION_TIMEOUT'); throw error; }
  if (result.code !== 0) throw new Error('SBOM_GENERATION_FAILED');
  let parsed: any; try { parsed = JSON.parse(result.stdout.toString('utf8')); } catch { throw new Error('SBOM_INVALID'); }
  // Syft names file-shaped components after the absolute path it scanned.
  // Normalize to repository-relative names here, at the single boundary
  // every consumer goes through, so no server path or per-run job id can
  // reach finding identity, the persisted SBOM, or an API response.
  // `raw` stays the untouched Syft output so rawSbomHash still attests to
  // exactly what the generator produced.
  const document = normalizeCycloneDxComponentNames(parsed, scanRoot);
  return { document, components: normalizeCycloneDx(document), raw: result.stdout, exitCode: result.code };
}

export function validateArchiveEntries(entries: string[]) {
  if (entries.length > MAX_FILE_COUNT) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\','/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(segment => segment === '..')) throw new Error('REPOSITORY_PATH_INVALID');
  }
}

export async function inspectTree(root: string) {
  const manifests: string[] = []; let fileCount = 0; let totalBytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('REPOSITORY_PATH_INVALID');
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        fileCount++; if (fileCount > MAX_FILE_COUNT) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
        totalBytes += (await lstat(absolute)).size; if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('REPOSITORY_TOO_LARGE');
        if (manifestNames.has(entry.name) || entry.name.endsWith('.csproj')) manifests.push(path.relative(root, absolute).replaceAll('\\','/'));
      }
    }
  }
  await walk(root); manifests.sort(); if (manifests.length === 0) throw new Error('NO_SUPPORTED_MANIFESTS'); return manifests;
}

async function locateSyft() {
  if (process.env.SYFT_PATH) return process.env.SYFT_PATH;
  if (process.platform !== 'win32') return 'syft';
  return path.join(process.env.LOCALAPPDATA || '', 'Microsoft','WinGet','Packages','Anchore.Syft_Microsoft.Winget.Source_8wekyb3d8bbwe','syft.exe');
}

export function normalizeCycloneDx(document: any) {
  if (!document || document.bomFormat !== 'CycloneDX' || !Array.isArray(document.components)) throw new Error('SBOM_INVALID');
  const unique = new Map<string, { name: string; version?: string; ecosystem?: string; purl?: string }>();
  for (const component of document.components) {
    if (typeof component?.name !== 'string' || component.name.trim().length === 0) throw new Error('SBOM_INVALID');
    const purl = typeof component.purl === 'string' ? component.purl : undefined;
    const version = typeof component.version === 'string' && component.version.length > 0 ? component.version : undefined;
    const ecosystem = purl?.startsWith('pkg:npm/') ? 'npm' : purl?.startsWith('pkg:pypi/') ? 'PyPI' : undefined;
    unique.set(`${purl || component.name}@${version || ''}`, { name: component.name, ...(version ? {version} : {}), ...(ecosystem ? {ecosystem} : {}), ...(purl ? {purl} : {}) });
  }
  const components = [...unique.values()].sort((a,b) => `${a.purl || a.name}@${a.version || ''}`.localeCompare(`${b.purl || b.name}@${b.version || ''}`));
  if (components.length === 0) throw new Error('SBOM_EMPTY'); return components;
}

async function processRepositoryJob(pool: Pool, job: ClaimedJob) {
  const source = (await pool.query('SELECT * FROM repository_scan_sources WHERE job_id = $1 AND tenant_id = $2', [job.id, job.tenant_id])).rows[0];
  if (!source) throw new Error('REPOSITORY_CONNECTION_NOT_FOUND');
  const connection = (await pool.query(`SELECT id FROM repository_connections WHERE id = $1 AND tenant_id = $2 AND provider = 'github' AND access_mode = 'public' AND status = 'Active'`, [source.connection_id, job.tenant_id])).rows[0];
  if (!connection) throw new Error('REPOSITORY_CONNECTION_NOT_FOUND');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `spr-repo-${job.id}-`));
  let cleanupSucceeded = false; const scannerStartedAt = new Date();
  try {
    const repoUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}`;
    const suppliedImmutableSha = typeof source.requested_ref === 'string' && /^[a-f0-9]{40}$/i.test(source.requested_ref);
    const metadata = suppliedImmutableSha ? null : await fetchJson(repoUrl, 'REPOSITORY_NOT_FOUND');
    if (metadata?.private) throw new Error('REPOSITORY_ACCESS_DENIED');
    const requestedRef = source.requested_ref || metadata?.default_branch; if (!requestedRef) throw new Error('REPOSITORY_REF_NOT_FOUND');
    const commitSha = suppliedImmutableSha ? requestedRef.toLowerCase() : (await fetchJson(`${repoUrl}/commits/${encodeURIComponent(requestedRef)}`, 'REPOSITORY_REF_NOT_FOUND'))?.sha;
    if (typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error('REPOSITORY_REF_NOT_FOUND');
    const descriptor = { provider:'github', owner:source.repository_owner, repository:source.repository_name, requestedRef, resolvedCommitSha:commitSha, subdirectory:source.repository_subdirectory, defaultBranch:metadata?.default_branch || null, visibility:metadata?.visibility || 'public', connectionId:source.connection_id, tenantId:job.tenant_id };
    const archivePath = path.join(tempRoot,'repository.zip'); const extractPath = path.join(tempRoot,'extracted'); const archiveExecutable = process.platform === 'win32' ? 'tar.exe' : 'unzip';
    await mkdir(extractPath);
    await downloadArchive(`${GITHUB_CODELOAD_ORIGIN}/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}/zip/${commitSha}`, archivePath);
    const listing = await runBounded(archiveExecutable, process.platform === 'win32' ? ['-tf',archivePath] : ['-Z1',archivePath], ACQUISITION_TIMEOUT_MS, 10 * 1024 * 1024);
    if (listing.code !== 0) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const entries = listing.stdout.toString('utf8').split(/\r?\n/).filter(Boolean); validateArchiveEntries(entries);
    const extraction = await runBounded(archiveExecutable, process.platform === 'win32' ? ['-xf',archivePath,'-C',extractPath] : ['-q',archivePath,'-d',extractPath], ACQUISITION_TIMEOUT_MS);
    if (extraction.code !== 0) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const roots = await readdir(extractPath,{withFileTypes:true}); const archiveRoot = roots.find(entry => entry.isDirectory()); if (!archiveRoot) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const repositoryRoot = path.join(extractPath,archiveRoot.name); const scanRoot = source.repository_subdirectory ? path.resolve(repositoryRoot,source.repository_subdirectory) : repositoryRoot;
    if (!scanRoot.startsWith(path.resolve(repositoryRoot) + path.sep) && scanRoot !== path.resolve(repositoryRoot)) throw new Error('REPOSITORY_PATH_INVALID');
    const scanRootStat = await lstat(scanRoot).catch(() => null); if (!scanRootStat?.isDirectory()) throw new Error('REPOSITORY_PATH_INVALID');
    const manifests = await inspectTree(scanRoot); const syftPath = await locateSyft(); const generated = await generateRepositorySbom(scanRoot,syftPath); const scannerEndedAt = new Date();
    const sbom = generated.document; const components = generated.components; const osvComponents = components.filter(component => component.version); if (osvComponents.length === 0) throw new Error('SBOM_EMPTY');
    const acquiredAt = new Date(); const sourceHash = sha256(JSON.stringify(descriptor)); const manifestHash = sha256(JSON.stringify(manifests)); const rawSbomHash = sha256(generated.raw); const componentsHash = sha256(JSON.stringify(components));
    const sbomEvidencePayload = JSON.stringify({format:'CycloneDX JSON',componentCount:components.length,rawSbomHash,normalizedComponentsHash:componentsHash});
    await pool.query(`UPDATE repository_scan_sources SET resolved_commit_sha=$2, default_branch=$3, visibility=$4, acquired_at=$5, source_descriptor_hash=$6, manifest_paths=$7, manifest_inventory_hash=$8, raw_sbom_hash=$9, sbom_document=$10, normalized_components=$11, normalized_components_hash=$12, scanner_name='Syft', scanner_version=$13, scanner_mode='directory CycloneDX JSON', scanner_started_at=$14, scanner_ended_at=$15, scanner_exit_code=0, scanner_error_category=NULL WHERE job_id=$1 AND tenant_id=$16`, [job.id,commitSha,descriptor.defaultBranch,descriptor.visibility,acquiredAt,sourceHash,JSON.stringify(manifests),manifestHash,rawSbomHash,JSON.stringify(sbom),JSON.stringify(components),componentsHash,SYFT_VERSION,scannerStartedAt,scannerEndedAt,job.tenant_id]);
    // Trust assessment is explicitly pending at this point (SBOM generated,
    // nothing scored yet) -- scores are NULL/'unverified', not a fabricated
    // 0, which would render as "confirmed untrustworthy" rather than "not
    // yet evaluated". The canonical scorer (src/trust/scoring-engine.ts)
    // is the only place that ever assigns a real, non-null score.
    await pool.query(`INSERT INTO passports (id,tenant_id,name,version,publisher,category,overall_score,security_score,compliance_score,vendor_reputation_score,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES ($1,$2,$3,$4,$5,'Repository',NULL,NULL,NULL,NULL,'unverified',$6,$7,'Unknown',$8,$9,'[]','[]','[]') ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version,file_hash=EXCLUDED.file_hash,sbom=EXCLUDED.sbom,overall_score=NULL,security_score=NULL,compliance_score=NULL,vendor_reputation_score=NULL,verification_status='unverified' WHERE passports.tenant_id=$2`, [job.passport_id,job.tenant_id,source.repository_name,commitSha,source.repository_owner,acquiredAt.toISOString().slice(0,10),sourceHash,'Repository acquired and SBOM generated. Trust assessment remains pending.',JSON.stringify(osvComponents)]);
    const repoEvidenceId = deterministicId('ev-repo',`${job.id}|${sourceHash}`); const manifestEvidenceId = deterministicId('ev-manifest',`${job.id}|${manifestHash}`); const sbomEvidenceId = deterministicId('ev-sbom',`${job.id}|${rawSbomHash}|${componentsHash}`);
    await pool.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,signer,timestamp,hash,raw_content,engine_id) VALUES ($1,$2,$3,'Repository source descriptor','Attestation',0,'github.com',$4,$5,$6,'repository-worker'),($7,$2,$3,'Manifest inventory','Build Log',0,'repository-worker',$4,$8,$9,'repository-worker'),($10,$2,$3,'Syft CycloneDX SBOM summary','Build Log',0,'Syft 1.49.0',$4,$11,$12,'repository-worker') ON CONFLICT (id) DO NOTHING`, [repoEvidenceId,job.tenant_id,job.passport_id,acquiredAt.toISOString(),`sha256:${sourceHash}`,JSON.stringify(descriptor),manifestEvidenceId,`sha256:${manifestHash}`,JSON.stringify(manifests),sbomEvidenceId,`sha256:${sha256(sbomEvidencePayload)}`,sbomEvidencePayload]);
    await processJob(pool,job);
    const findings = (await pool.query('SELECT title,component,status,detected_at FROM scan_findings WHERE job_id=$1 AND tenant_id=$2 ORDER BY id',[job.id,job.tenant_id])).rows;
    await pool.query('UPDATE repository_scan_sources SET final_findings_hash=$2 WHERE job_id=$1 AND tenant_id=$3',[job.id,sha256(JSON.stringify(findings)),job.tenant_id]);
  } catch (error: any) {
    await pool.query(`UPDATE repository_scan_sources SET scanner_ended_at=NOW(), scanner_exit_code=COALESCE(scanner_exit_code,-1), scanner_error_category=$2 WHERE job_id=$1 AND tenant_id=$3`,[job.id,String(error?.message || 'REPOSITORY_SCAN_FAILED').slice(0,100),job.tenant_id]);
    throw error;
  } finally {
    try { await rm(tempRoot,{recursive:true,force:true}); cleanupSucceeded = true; } finally {
      await pool.query('UPDATE repository_scan_sources SET temporary_directory_removed=$2 WHERE job_id=$1 AND tenant_id=$3',[job.id,cleanupSucceeded ? 1 : 0,job.tenant_id]);
    }
  }
}

async function failJob(pool: Pool, job: ClaimedJob, error: unknown) {
  const code = error instanceof Error ? error.message : 'SCAN_WORKER_ERROR';
  const retry = job.attempt_count < job.max_attempts;
  const next = retry ? Math.min(60 * Math.pow(2, Math.max(0, job.attempt_count - 1)), 3600) : 0;
  await pool.query(`UPDATE agent_jobs SET status=$2, progress=CASE WHEN $2='Failed' THEN 100 ELSE 0 END, error=$3, next_attempt_at=CASE WHEN $2='Pending' THEN NOW() + ($4 * INTERVAL '1 second') ELSE next_attempt_at END, locked_at=NULL, locked_by=NULL, completed_at=CASE WHEN $2='Failed' THEN NOW() ELSE completed_at END, updated_at=NOW() WHERE id=$1 AND tenant_id=$5 AND status='Running' AND locked_by=$6`,[job.id,retry ? 'Pending' : 'Failed',code.slice(0,200),next,job.tenant_id,WORKER_ID]);
}

export async function runWorkerOnce(pool: Pool) {
  const job = await claimJob(pool); if (!job) return false;
  try { if (job.job_type === 'repository_scan') await processRepositoryJob(pool,job); else await processJob(pool,job); }
  catch (error) { await failJob(pool,job,error); }
  return true;
}

export async function runWorkerLoop() {
  const pool = createWorkerPool();
  await pool.query('SELECT 1');
  let stopping = false; const stop = () => { stopping = true; };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  console.log(JSON.stringify({event:'worker_started',workerId:WORKER_ID}));
  try { while (!stopping) { const processed = await runWorkerOnce(pool); if (!processed) await new Promise(resolve => setTimeout(resolve,2_000)); } }
  finally { await pool.end(); console.log(JSON.stringify({event:'worker_stopped',workerId:WORKER_ID})); }
}
