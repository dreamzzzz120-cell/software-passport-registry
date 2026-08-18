import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Pool, PoolClient } from 'pg';

type ClaimedJob = {
  id: string;
  tenant_id: string;
  passport_id: string;
  attempt_count: number;
  max_attempts: number;
  job_type: string;
};

type SbomComponent = {
  name?: string;
  version?: string;
  ecosystem?: string;
};

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const PROVIDER_TIMEOUT_MS = 15_000;

export function createWorkerPool() {
  const sslMode = process.env.SQL_SSL?.trim().toLowerCase();
  return new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    ssl: sslMode === 'require' || sslMode === 'true'
      ? { rejectUnauthorized: true }
      : undefined,
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
}

async function claimJob(pool: Pool): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<ClaimedJob>(`
      SELECT id, tenant_id, passport_id, attempt_count, max_attempts, job_type
      FROM agent_jobs
      WHERE status = 'Pending'
        AND job_type IN ('osv_manifest_scan', 'repository_scan')
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const job = result.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(`
      UPDATE agent_jobs
      SET status = 'Running',
          progress = 10,
          attempt_count = attempt_count + 1,
          locked_at = NOW(),
          locked_by = $2,
          updated_at = NOW()
      WHERE id = $1
    `, [job.id, WORKER_ID]);
    await client.query('COMMIT');
    return { ...job, attempt_count: job.attempt_count + 1 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fetchOsv(component: Required<Pick<SbomComponent, 'name' | 'version'>> & SbomComponent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package: {
          name: component.name,
          ecosystem: component.ecosystem || 'npm',
        },
        version: component.version,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OSV_HTTP_${response.status}`);
    }
    return { response: JSON.parse(text), raw: text };
  } finally {
    clearTimeout(timeout);
  }
}

async function persistProviderResult(
  client: PoolClient,
  job: ClaimedJob,
  component: Required<Pick<SbomComponent, 'name' | 'version'>> & SbomComponent,
  providerResponse: unknown,
) {
  const timestamp = new Date().toISOString();
  const evidenceId = `ev-osv-${crypto.randomUUID()}`;
  const persistedPayload = JSON.stringify({
    source: 'https://api.osv.dev/v1/query',
    requestedComponent: component,
    receivedAt: timestamp,
    response: providerResponse,
  });
  const digest = `sha256:${crypto.createHash('sha256').update(persistedPayload, 'utf8').digest('hex')}`;
  await client.query(`
    INSERT INTO evidence_items
      (id, tenant_id, asset_id, name, type, verified, status, signer, timestamp, hash,
       raw_content, engine_id, verification_failure_reason)
    VALUES ($1, $2, $3, $4, 'Security Scan', 0, 'OBSERVED', 'api.osv.dev', $5, $6, $7,
            'osv-worker', NULL)
  `, [
    evidenceId,
    job.tenant_id,
    job.passport_id,
    `OSV response for ${component.name}@${component.version}`,
    timestamp,
    digest,
    persistedPayload,
  ]);

  const vulnerabilities = Array.isArray((providerResponse as any)?.vulns)
    ? (providerResponse as any).vulns
    : [];
  for (const vulnerability of vulnerabilities) {
    const aliases = Array.isArray(vulnerability.aliases) ? vulnerability.aliases : [];
    await client.query(`
      INSERT INTO scan_findings
        (id, tenant_id, asset_id, job_id, severity, category, title, description,
         component, status, detected_at, engine_id)
      VALUES ($1, $2, $3, $4, 'Unknown', 'Vulnerability', $5, $6, $7, 'Open', $8, 'osv-worker')
    `, [
      `finding-osv-${crypto.randomUUID()}`,
      job.tenant_id,
      job.passport_id,
      job.id,
      vulnerability.id || 'OSV vulnerability',
      vulnerability.summary || aliases.join(', ') || 'OSV returned a vulnerability record.',
      `${component.name}@${component.version}`,
      timestamp,
    ]);
  }
  return vulnerabilities.length;
}

async function processJob(pool: Pool, job: ClaimedJob) {
  const passportResult = await pool.query(
    'SELECT name, version, sbom FROM passports WHERE id = $1 AND tenant_id = $2',
    [job.passport_id, job.tenant_id],
  );
  const passport = passportResult.rows[0];
  if (!passport) throw new Error('PASSPORT_NOT_FOUND');

  let parsed: unknown;
  try {
    parsed = JSON.parse(passport.sbom || '[]');
  } catch {
    throw new Error('SBOM_MALFORMED');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('SBOM_EMPTY');
  }
  const components = (parsed as SbomComponent[]).filter(
    (component): component is Required<Pick<SbomComponent, 'name' | 'version'>> & SbomComponent =>
      typeof component?.name === 'string' && component.name.length > 0 &&
      typeof component?.version === 'string' && component.version.length > 0,
  );
  if (components.length === 0) throw new Error('SBOM_HAS_NO_VERSIONED_COMPONENTS');

  let findingCount = 0;
  for (const component of components) {
    const provider = await fetchOsv(component);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      findingCount += await persistProviderResult(
        client,
        job,
        component,
        provider.response,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const completedAt = new Date().toISOString();
  await pool.query(`
    INSERT INTO scans
      (id, tenant_id, target_name, scan_type, triggered_by, status, duration_ms,
       findings_count, timestamp, client_name)
    VALUES ($1, $2, $3, 'OSV manifest component query', $4, 'Completed', 0, $5, $6, $7)
  `, [
    `scan-osv-${crypto.randomUUID()}`,
    job.tenant_id,
    `${passport.name} ${passport.version}`,
    WORKER_ID,
    findingCount,
    completedAt,
    'Persisted passport SBOM',
  ]);
  await pool.query(`
    UPDATE agent_jobs
    SET status = 'Completed', progress = 100, result = $2, error = NULL,
        completed_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE id = $1
  `, [
    job.id,
    JSON.stringify({
      provider: 'OSV',
      evidenceState: 'Provider response persisted; not a cryptographic verification',
      componentsQueried: components.length,
      findingsPersisted: findingCount,
      completedAt,
    }),
  ]);
}

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_COUNT = 50_000;
const ACQUISITION_TIMEOUT_MS = 30_000;
const SBOM_TIMEOUT_MS = 120_000;
const SYFT_VERSION = '1.49.0';
const manifestNames = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'poetry.lock', 'Pipfile', 'Pipfile.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile', 'packages.lock.json', 'packages.config',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock',
]);
const ignoredDirectories = new Set([
  '.git', 'node_modules', 'vendor', 'build', 'dist', '.cache', '__pycache__',
  '.venv', 'venv', 'coverage', 'target',
]);

function sha256(value: string | Buffer) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fetchJson(url: string, notFoundCode: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACQUISITION_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'spr-repository-worker/1.0',
      },
      signal: controller.signal,
    });
    if (response.status === 404 || response.status === 422) throw new Error(notFoundCode);
    if (response.status === 403) throw new Error('REPOSITORY_ACCESS_DENIED');
    if (!response.ok) throw new Error('REPOSITORY_ACCESS_DENIED');
    return await response.json();
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('REPOSITORY_ACQUISITION_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadArchive(
  url: string,
  destination: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? ACQUISITION_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'spr-repository-worker/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status === 404) throw new Error('REPOSITORY_NOT_FOUND');
    if (response.status === 403) throw new Error('REPOSITORY_ACCESS_DENIED');
    if (!response.ok || !response.body) throw new Error('REPOSITORY_ACCESS_DENIED');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) throw new Error('REPOSITORY_TOO_LARGE');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as any) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) throw new Error('REPOSITORY_TOO_LARGE');
      chunks.push(buffer);
    }
    await writeFile(destination, Buffer.concat(chunks));
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('REPOSITORY_ACQUISITION_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runBounded(
  executable: string,
  args: string[],
  timeoutMs: number,
  outputLimit = 60 * 1024 * 1024,
) {
  return await new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(executable.toLowerCase().includes('syft')
        ? 'SBOM_GENERATION_TIMEOUT'
        : 'REPOSITORY_ACQUISITION_TIMEOUT'));
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdoutSize += chunk.length;
      if (stdoutSize > outputLimit) {
        child.kill();
        reject(new Error('SBOM_INVALID'));
      } else {
        stdout.push(Buffer.from(chunk));
      }
    });
    child.stderr.on('data', chunk => {
      if (stderr.reduce((sum, value) => sum + value.length, 0) < 32_768) {
        stderr.push(Buffer.from(chunk));
      }
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error(executable.toLowerCase().includes('syft')
        ? 'SBOM_GENERATOR_NOT_AVAILABLE'
        : 'REPOSITORY_ACQUISITION_FAILED'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

export async function generateRepositorySbom(
  scanRoot: string,
  syftPath: string,
  options: { timeoutMs?: number; executableArgsPrefix?: string[] } = {},
) {
  const prefix = options.executableArgsPrefix || [];
  const versionResult = await runBounded(
    syftPath,
    [...prefix, 'version', '-o', 'json'],
    15_000,
    1024 * 1024,
  );
  if (versionResult.code !== 0 || !versionResult.stdout.toString('utf8').includes(SYFT_VERSION)) {
    throw new Error('SBOM_GENERATOR_NOT_AVAILABLE');
  }
  let result;
  try {
    result = await runBounded(
      syftPath,
      [...prefix, 'scan', `dir:${scanRoot}`, '-o', 'cyclonedx-json'],
      options.timeoutMs ?? SBOM_TIMEOUT_MS,
    );
  } catch (error: any) {
    if (error?.message === 'REPOSITORY_ACQUISITION_TIMEOUT') {
      throw new Error('SBOM_GENERATION_TIMEOUT');
    }
    throw error;
  }
  if (result.code !== 0) throw new Error('SBOM_GENERATION_FAILED');
  let document: any;
  try {
    document = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    throw new Error('SBOM_INVALID');
  }
  return {
    document,
    components: normalizeCycloneDx(document),
    raw: result.stdout,
    exitCode: result.code,
  };
}

export function validateArchiveEntries(entries: string[]) {
  if (entries.length > MAX_FILE_COUNT) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.split('/').some(segment => segment === '..')
    ) {
      throw new Error('REPOSITORY_PATH_INVALID');
    }
  }
}

export async function inspectTree(root: string) {
  const manifests: string[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('REPOSITORY_PATH_INVALID');
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        fileCount++;
        if (fileCount > MAX_FILE_COUNT) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
        totalBytes += (await lstat(absolute)).size;
        if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('REPOSITORY_TOO_LARGE');
        if (manifestNames.has(entry.name) || entry.name.endsWith('.csproj')) {
          manifests.push(path.relative(root, absolute).replaceAll('\\', '/'));
        }
      }
    }
  }
  await walk(root);
  manifests.sort();
  if (manifests.length === 0) throw new Error('NO_SUPPORTED_MANIFESTS');
  return manifests;
}

async function locateSyft() {
  if (process.env.SYFT_PATH) return process.env.SYFT_PATH;
  if (process.platform !== 'win32') return 'syft';
  const packageRoot = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft', 'WinGet', 'Packages',
    'Anchore.Syft_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'syft.exe',
  );
  return packageRoot;
}

export function normalizeCycloneDx(document: any) {
  if (!document || document.bomFormat !== 'CycloneDX' || !Array.isArray(document.components)) {
    throw new Error('SBOM_INVALID');
  }
  const unique = new Map<string, { name: string; version?: string; ecosystem?: string; purl?: string }>();
  for (const component of document.components) {
    if (typeof component?.name !== 'string' || component.name.trim().length === 0) {
      throw new Error('SBOM_INVALID');
    }
    const purl = typeof component.purl === 'string' ? component.purl : undefined;
    const version = typeof component.version === 'string' && component.version.length > 0
      ? component.version
      : undefined;
    const ecosystem = purl?.startsWith('pkg:npm/') ? 'npm'
      : purl?.startsWith('pkg:pypi/') ? 'PyPI'
      : undefined;
    const normalized = { name: component.name, ...(version ? { version } : {}), ...(ecosystem ? { ecosystem } : {}), ...(purl ? { purl } : {}) };
    unique.set(`${purl || component.name}@${version || ''}`, normalized);
  }
  const components = [...unique.values()].sort((a, b) =>
    `${a.purl || a.name}@${a.version || ''}`.localeCompare(`${b.purl || b.name}@${b.version || ''}`)
  );
  if (components.length === 0) throw new Error('SBOM_EMPTY');
  return components;
}

async function processRepositoryJob(pool: Pool, job: ClaimedJob) {
  const source = (await pool.query(
    'SELECT * FROM repository_scan_sources WHERE job_id = $1 AND tenant_id = $2',
    [job.id, job.tenant_id],
  )).rows[0];
  if (!source) throw new Error('REPOSITORY_CONNECTION_NOT_FOUND');
  const connection = (await pool.query(
    `SELECT id FROM repository_connections
     WHERE id = $1 AND tenant_id = $2 AND provider = 'github'
       AND access_mode = 'public' AND status = 'Active'`,
    [source.connection_id, job.tenant_id],
  )).rows[0];
  if (!connection) throw new Error('REPOSITORY_CONNECTION_NOT_FOUND');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `spr-repo-${job.id}-`));
  let cleanupSucceeded = false;
  const scannerStartedAt = new Date();
  try {
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}`;
    const suppliedImmutableSha = typeof source.requested_ref === 'string' &&
      /^[a-f0-9]{40}$/i.test(source.requested_ref);
    const metadata = suppliedImmutableSha
      ? null
      : await fetchJson(repoUrl, 'REPOSITORY_NOT_FOUND');
    if (metadata?.private) throw new Error('REPOSITORY_ACCESS_DENIED');
    const requestedRef = source.requested_ref || metadata?.default_branch;
    if (!requestedRef) throw new Error('REPOSITORY_REF_NOT_FOUND');
    const commitSha = suppliedImmutableSha
      ? requestedRef.toLowerCase()
      : (await fetchJson(
        `${repoUrl}/commits/${encodeURIComponent(requestedRef)}`,
        'REPOSITORY_REF_NOT_FOUND',
      ))?.sha;
    if (typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/i.test(commitSha)) {
      throw new Error('REPOSITORY_REF_NOT_FOUND');
    }
    const descriptor = {
      provider: 'github',
      owner: source.repository_owner,
      repository: source.repository_name,
      requestedRef,
      resolvedCommitSha: commitSha,
      subdirectory: source.repository_subdirectory,
      defaultBranch: metadata?.default_branch || null,
      visibility: metadata?.visibility || 'public',
      connectionId: source.connection_id,
      tenantId: job.tenant_id,
    };
    const archivePath = path.join(tempRoot, 'repository.zip');
    const extractPath = path.join(tempRoot, 'extracted');
    const archiveExecutable = process.platform === 'win32' ? 'tar.exe' : 'unzip';
    await mkdir(extractPath);
    await downloadArchive(
      `https://codeload.github.com/${encodeURIComponent(source.repository_owner)}/${encodeURIComponent(source.repository_name)}/zip/${commitSha}`,
      archivePath
    );
    const listing = await runBounded(
      archiveExecutable,
      process.platform === 'win32' ? ['-tf', archivePath] : ['-Z1', archivePath],
      ACQUISITION_TIMEOUT_MS,
      10 * 1024 * 1024
    );
    if (listing.code !== 0) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const entries = listing.stdout.toString('utf8').split(/\r?\n/).filter(Boolean);
    validateArchiveEntries(entries);
    const extraction = await runBounded(
      archiveExecutable,
      process.platform === 'win32'
        ? ['-xf', archivePath, '-C', extractPath]
        : ['-q', archivePath, '-d', extractPath],
      ACQUISITION_TIMEOUT_MS
    );
    if (extraction.code !== 0) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const roots = await readdir(extractPath, { withFileTypes: true });
    const archiveRoot = roots.find(entry => entry.isDirectory());
    if (!archiveRoot) throw new Error('REPOSITORY_ACQUISITION_FAILED');
    const repositoryRoot = path.join(extractPath, archiveRoot.name);
    const scanRoot = source.repository_subdirectory
      ? path.resolve(repositoryRoot, source.repository_subdirectory)
      : repositoryRoot;
    if (!scanRoot.startsWith(path.resolve(repositoryRoot) + path.sep) && scanRoot !== path.resolve(repositoryRoot)) {
      throw new Error('REPOSITORY_PATH_INVALID');
    }
    const scanRootStat = await lstat(scanRoot).catch(() => null);
    if (!scanRootStat?.isDirectory()) throw new Error('REPOSITORY_PATH_INVALID');
    const manifests = await inspectTree(scanRoot);
    const syftPath = await locateSyft();
    const generated = await generateRepositorySbom(scanRoot, syftPath);
    const scannerEndedAt = new Date();
    const sbom = generated.document;
    const components = generated.components;
    const osvComponents = components.filter(component => component.version);
    if (osvComponents.length === 0) throw new Error('SBOM_EMPTY');
    const acquiredAt = new Date();
    const sourceHash = sha256(JSON.stringify(descriptor));
    const manifestHash = sha256(JSON.stringify(manifests));
    const rawSbomHash = sha256(generated.raw);
    const componentsHash = sha256(JSON.stringify(components));
    const sbomEvidencePayload = JSON.stringify({
      format: 'CycloneDX JSON',
      componentCount: components.length,
      rawSbomHash,
      normalizedComponentsHash: componentsHash,
    });
    await pool.query(`
      UPDATE repository_scan_sources SET
        resolved_commit_sha = $2, default_branch = $3, visibility = $4,
        acquired_at = $5, source_descriptor_hash = $6, manifest_paths = $7,
        manifest_inventory_hash = $8, raw_sbom_hash = $9, sbom_document = $10,
        normalized_components = $11, normalized_components_hash = $12,
        scanner_name = 'Syft', scanner_version = $13,
        scanner_mode = 'directory CycloneDX JSON',
        scanner_started_at = $14, scanner_ended_at = $15,
        scanner_exit_code = 0, scanner_error_category = NULL
      WHERE job_id = $1
    `, [
      job.id, commitSha, descriptor.defaultBranch, descriptor.visibility,
      acquiredAt, sourceHash, JSON.stringify(manifests), manifestHash,
      rawSbomHash, JSON.stringify(sbom), JSON.stringify(components), componentsHash, SYFT_VERSION,
      scannerStartedAt, scannerEndedAt,
    ]);
    await pool.query(`
      INSERT INTO passports
        (id, tenant_id, name, version, publisher, category, overall_score,
         security_score, compliance_score, vendor_reputation_score, release_date,
         file_hash, license_type, ai_summary, sbom, evidence, vulnerabilities, timeline)
      VALUES ($1, $2, $3, $4, $5, 'Repository', 0, 0, 0, 0, $6, $7,
              'Unknown', $8, $9, '[]', '[]', '[]')
      ON CONFLICT (id) DO UPDATE SET
        version = EXCLUDED.version, file_hash = EXCLUDED.file_hash,
        sbom = EXCLUDED.sbom, overall_score = 0, security_score = 0,
        compliance_score = 0, vendor_reputation_score = 0
    `, [
      job.passport_id, job.tenant_id, source.repository_name, commitSha,
      source.repository_owner, acquiredAt.toISOString().slice(0, 10),
      sourceHash,
      'Repository acquired and SBOM generated. Trust assessment remains pending.',
      JSON.stringify(osvComponents),
    ]);
    await pool.query(`
      INSERT INTO evidence_items
        (id, tenant_id, asset_id, name, type, verified, signer, timestamp, hash,
         raw_content, engine_id)
      VALUES ($1, $2, $3, 'Repository source descriptor', 'Attestation', 0,
              'github.com', $4, $5, $6, 'repository-worker'),
             ($7, $2, $3, 'Manifest inventory', 'Build Log', 0,
              'repository-worker', $4, $8, $9, 'repository-worker'),
             ($10, $2, $3, 'Syft CycloneDX SBOM summary', 'Build Log', 0,
              'Syft 1.49.0', $4, $11, $12, 'repository-worker')
    `, [
      `ev-repo-${crypto.randomUUID()}`, job.tenant_id, job.passport_id,
      acquiredAt.toISOString(), `sha256:${sourceHash}`, JSON.stringify(descriptor),
      `ev-manifest-${crypto.randomUUID()}`, `sha256:${manifestHash}`, JSON.stringify(manifests),
      `ev-sbom-${crypto.randomUUID()}`, `sha256:${sha256(sbomEvidencePayload)}`,
      sbomEvidencePayload,
    ]);
    await processJob(pool, job);
    const findings = (await pool.query(
      'SELECT title, component, status, detected_at FROM scan_findings WHERE job_id = $1 ORDER BY id',
      [job.id],
    )).rows;
    await pool.query(
      'UPDATE repository_scan_sources SET final_findings_hash = $2 WHERE job_id = $1',
      [job.id, sha256(JSON.stringify(findings))],
    );
  } catch (error: any) {
    await pool.query(`
      UPDATE repository_scan_sources SET
        scanner_ended_at = NOW(), scanner_exit_code = COALESCE(scanner_exit_code, -1),
        scanner_error_category = $2
      WHERE job_id = $1
    `, [job.id, String(error?.message || 'REPOSITORY_SCAN_FAILED').slice(0, 100)]);
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    cleanupSucceeded = true;
    await pool.query(
      'UPDATE repository_scan_sources SET temporary_directory_removed = $2 WHERE job_id = $1',
      [job.id, cleanupSucceeded ? 1 : 0],
    );
  }
}

async function failJob(pool: Pool, job: ClaimedJob, error: unknown) {
  const code = error instanceof Error ? error.message : 'SCAN_WORKER_ERROR';
  const retry = job.attempt_count < job.max_attempts;
  await pool.query(`
    UPDATE agent_jobs
    SET status = $2,
        progress = CASE WHEN $2 = 'Failed' THEN 100 ELSE 0 END,
        error = $3,
        next_attempt_at = CASE WHEN $2 = 'Pending' THEN NOW() + INTERVAL '30 seconds' ELSE next_attempt_at END,
        locked_at = NULL,
        locked_by = NULL,
        completed_at = CASE WHEN $2 = 'Failed' THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, retry ? 'Pending' : 'Failed', code.slice(0, 200)]);
}

export async function runWorkerOnce(pool: Pool) {
  const job = await claimJob(pool);
  if (!job) return false;
  try {
    if (job.job_type === 'repository_scan') {
      await processRepositoryJob(pool, job);
    } else {
      await processJob(pool, job);
    }
  } catch (error) {
    await failJob(pool, job, error);
  }
  return true;
}

export async function runWorkerLoop() {
  const pool = createWorkerPool();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(JSON.stringify({ event: 'worker_started', workerId: WORKER_ID }));
  try {
    while (!stopping) {
      const processed = await runWorkerOnce(pool);
      if (!processed) await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  } finally {
    await pool.end();
    console.log(JSON.stringify({ event: 'worker_stopped', workerId: WORKER_ID }));
  }
}
