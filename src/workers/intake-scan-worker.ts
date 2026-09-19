/**
 * Uploaded-file scans. Until this worker existed, files a customer uploaded
 * through the universal intake were stored, marked QUEUED and never looked at,
 * while the UI reported them as "queued for SPR analysis". This worker consumes
 * an intake session as one scan run: every uploaded item becomes an inventory
 * row, archives are extracted inside strict bounds and every member becomes a
 * row of its own, Syft catalogs the tree, OSV is queried for the components,
 * and the content engines read what they support. Everything else is recorded
 * as what it is -- unsupported, skipped, failed -- never as inspected.
 *
 * Uploaded bytes are hostile input: nothing is executed, symlinks are never
 * followed, archive entries are validated for traversal before extraction,
 * expansion is bounded by count and bytes, and every temp directory is removed.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createWorkerPool, assertWorkerDatabase } from './worker-db.ts';
import { generateRepositorySbom, locateSyft, processJob, rootErrorMessage, runBounded, safeFailureReason, SYFT_VERSION, validateArchiveEntries } from './osv-worker.ts';
import { runRealRepositoryScanners, contentUnsupportedReason } from '../scanners/real-repository-scanners.ts';
import { applyCatalogLocations, applyContentInspection, enumerateNestedArchives, finalizeDispositions, newEntry, observeExtractedEntries, setOutcome, type InventoryEntry, type InventoryTool } from '../scanners/file-inventory.ts';
import { makeArchiveLister, SYFT_TOOL } from '../scanners/repository-inventory.ts';
import { markScanRunRunning, persistInventory, recomputeCoverage, recordPassportAssociation, settleScanRun, type LedgerContext } from '../scanners/scan-ledger.ts';
import { calculateAndStoreTrustScore } from '../utils/scanner.ts';
import { scanFindingIdentity } from '../security/scan-finding-identity.ts';
import { appendAuditEntryViaPool } from '../security/audit-log.ts';

const WORKER_ID = `${os.hostname()}:${process.pid}:intake`;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 50_000;
const MAX_ITEM_BYTES = 50 * 1024 * 1024;
const INTAKE_TOOL: InventoryTool = { name: 'spr-intake-scanner', version: '1', action: 'acquire' };
const EXTRACT_TOOL: InventoryTool = { name: 'spr-archive-extractor', version: '1', action: 'extract' };
const BUCKET_FALLBACK = 'spr-intake';

function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
function deterministicId(prefix: string, value: string) { return `${prefix}-${sha256(value).slice(0, 48)}`; }

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('INTAKE_STORAGE_NOT_CONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function claimJob(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE agent_jobs SET status=CASE WHEN attempt_count < max_attempts THEN 'Pending' ELSE 'Failed' END, error=CASE WHEN attempt_count < max_attempts THEN NULL ELSE 'INTAKE_SCAN_LEASE_EXPIRED' END, next_attempt_at=CASE WHEN attempt_count < max_attempts THEN NOW() ELSE next_attempt_at END, locked_at=NULL, locked_by=NULL, updated_at=NOW(), completed_at=CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE completed_at END WHERE job_type='intake_scan' AND status='Running' AND locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '15 minutes'`);
    const result = await client.query(`SELECT id, tenant_id, passport_id, attempt_count, max_attempts, scan_id, job_type FROM agent_jobs WHERE status='Pending' AND job_type='intake_scan' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    const job = result.rows[0];
    if (!job) { await client.query('COMMIT'); return null; }
    await client.query(`UPDATE agent_jobs SET status='Running', progress=5, attempt_count=attempt_count+1, locked_at=NOW(), locked_by=$2, updated_at=NOW() WHERE id=$1 AND tenant_id=$3`, [job.id, WORKER_ID, job.tenant_id]);
    await client.query('COMMIT');
    return { ...job, attempt_count: Number(job.attempt_count) + 1 };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

/** Unique on-disk/display name per item so two uploads named the same are two entries, not one overwriting the other. */
function displayNames(items: Array<{ name: string }>): string[] {
  const used = new Map<string, number>();
  return items.map((item) => {
    const base = item.name.normalize('NFKC').replace(/[\\/\0]/g, '_').replace(/[^A-Za-z0-9._()\- ]/g, '_').trim() || 'file';
    const count = used.get(base.toLowerCase()) ?? 0;
    used.set(base.toLowerCase(), count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? `${base.slice(0, dot)} (${count + 1})${base.slice(dot)}` : `${base} (${count + 1})`;
  });
}

function isExtractable(name: string): 'zip' | 'tar' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (/\.(tar|tgz|tar\.gz|gz)$/.test(lower)) return 'tar';
  return null;
}

/**
 * Reads the sizes an archive DECLARES for its members before anything is
 * extracted. A decompression bomb announces its expanded size in the central
 * directory (it must, or the extractor could not write it), so refusing on the
 * declared total stops the expansion before it starts; the post-extraction
 * walk below is the second gate for archives whose headers lie.
 */
export function parseDeclaredSizes(kind: 'zip' | 'tar', output: string): { entries: number; bytes: number } | null {
  let entries = 0; let bytes = 0; let matched = false;
  for (const line of output.split(/\r?\n/)) {
    // unzip -l:  "     1234  2026-09-18 01:34   dir/file"
    // tar -tvf:  "-rw-r--r-- user/group 1234 2026-09-18 01:34 dir/file"
    const m = kind === 'zip' && process.platform !== 'win32'
      ? /^\s*(\d+)\s+\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/.exec(line)
      : /^[-a-zA-Z]{10}\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/.exec(line);
    if (!m) continue;
    matched = true;
    if (m[2].endsWith('/')) continue;
    entries++; bytes += Number(m[1]);
  }
  return matched ? { entries, bytes } : null;
}

async function declaredArchiveSize(kind: 'zip' | 'tar', archivePath: string): Promise<{ entries: number; bytes: number } | null> {
  const executable = process.platform === 'win32' ? 'tar.exe' : kind === 'zip' ? 'unzip' : 'tar';
  const args = process.platform === 'win32' ? ['-tvf', archivePath] : kind === 'zip' ? ['-l', archivePath] : ['-tvf', archivePath];
  let result = await runBounded(executable, args, 30_000, 20 * 1024 * 1024).catch(() => null);
  if ((!result || result.code !== 0) && process.platform === 'win32') result = await runBounded(executable, ['--force-local', ...args], 30_000, 20 * 1024 * 1024).catch(() => null);
  if (!result || result.code !== 0) return null;
  return parseDeclaredSizes(kind, result.stdout.toString('utf8'));
}

async function walkCount(root: string): Promise<{ files: number; bytes: number; symlinks: number }> {
  let files = 0, bytes = 0, symlinks = 0;
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { symlinks++; continue; }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { files++; bytes += (await lstat(full)).size; if (files > MAX_EXTRACTED_FILES) throw new Error('ARCHIVE_FILE_LIMIT_EXCEEDED'); if (bytes > MAX_EXTRACTED_BYTES) throw new Error('ARCHIVE_EXPANSION_LIMIT_EXCEEDED'); }
    }
  }
  await walk(root);
  return { files, bytes, symlinks };
}

async function processIntakeJob(pool: Pool, job: any) {
  const source = (await pool.query('SELECT * FROM intake_scan_sources WHERE job_id=$1 AND tenant_id=$2', [job.id, job.tenant_id])).rows[0];
  if (!source) throw new Error('INTAKE_SOURCE_NOT_FOUND');
  const run = (await pool.query('SELECT id, client_id FROM scans WHERE id=$1 AND tenant_id=$2', [source.scan_id, job.tenant_id])).rows[0];
  if (!run) throw new Error('SCAN_RUN_NOT_FOUND');
  const ledger: LedgerContext = { tenantId: job.tenant_id, scanId: run.id, passportId: job.passport_id, clientId: run.client_id ?? null };
  await markScanRunRunning(pool, job.tenant_id, ledger.scanId);
  const items = (await pool.query(`SELECT id, name, size, content_type, kind, storage_bucket, storage_path, sha256, status FROM intake_items WHERE session_id=$1 AND tenant_id=$2 AND status IN ('QUEUED','PROCESSING','UPLOADED','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED') ORDER BY created_at ASC`, [source.session_id, job.tenant_id])).rows;
  if (items.length === 0) throw new Error('INTAKE_SESSION_EMPTY');
  await pool.query(`UPDATE intake_items SET status='PROCESSING' WHERE session_id=$1 AND tenant_id=$2 AND status IN ('QUEUED','UPLOADED')`, [source.session_id, job.tenant_id]);
  const log = (event: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, scanId: ledger.scanId, passportId: job.passport_id, ...extra }));

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `spr-intake-${job.id}-`));
  const scanRoot = path.join(tempRoot, 'scan');
  const archiveRoot = path.join(tempRoot, 'archives');
  await mkdir(scanRoot); await mkdir(archiveRoot);
  let cleanupSucceeded = false;
  const entries: InventoryEntry[] = [];
  const itemOutcome = new Map<string, 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED'>();
  try {
    const storage = supabaseAdmin();
    const names = displayNames(items);
    let sequence = 0;
    const limitations: string[] = [];
    // 1. Acquire every item, verify it against the hash SPR recorded at upload,
    //    and give it an inventory row whatever happens next.
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const display = names[index];
      const entry = newEntry(sequence++, display, 'intake-upload', null, 0);
      entries.push(entry);
      if (Number(item.size) > MAX_ITEM_BYTES) { setOutcome(entry, { disposition: 'skipped', reasonCode: 'FILE_TOO_LARGE', reasonDetail: 'The uploaded item exceeds the per-file scan limit.', tool: INTAKE_TOOL }); itemOutcome.set(item.id, 'FAILED'); continue; }
      let bytes: Buffer;
      try {
        const downloaded = await storage.storage.from(item.storage_bucket || process.env.SPR_INTAKE_BUCKET?.trim() || BUCKET_FALLBACK).download(item.storage_path);
        if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message || 'download failed');
        bytes = Buffer.from(await downloaded.data.arrayBuffer());
      } catch (error) {
        setOutcome(entry, { disposition: 'inaccessible', reasonCode: 'STORAGE_OBJECT_UNAVAILABLE', reasonDetail: safeFailureReason(rootErrorMessage(error)), tool: INTAKE_TOOL });
        itemOutcome.set(item.id, 'FAILED');
        continue;
      }
      const digest = sha256(bytes);
      if (item.sha256 && item.sha256 !== digest) {
        setOutcome(entry, { disposition: 'failed', reasonCode: 'INTEGRITY_MISMATCH', reasonDetail: 'The stored object no longer matches the SHA-256 SPR recorded at upload; it was not scanned.', tool: INTAKE_TOOL });
        entry.size = bytes.length; entry.sha256 = digest;
        itemOutcome.set(item.id, 'FAILED');
        continue;
      }
      const kind = isExtractable(display);
      if (kind) {
        // Archives live outside the scan root so the cataloger sees their
        // members, not the container; each member becomes its own row.
        const archivePath = path.join(archiveRoot, `${item.id}${kind === 'zip' ? '.zip' : '.tar'}`);
        await writeFile(archivePath, bytes);
        entry.size = bytes.length; entry.sha256 = digest; entry.isArchive = true; entry.absolutePath = archivePath;
        const listing = await runBounded(process.platform === 'win32' ? 'tar.exe' : (kind === 'zip' ? 'unzip' : 'tar'), process.platform === 'win32' ? ['-tf', archivePath] : (kind === 'zip' ? ['-Z1', archivePath] : ['-tf', archivePath]), 30_000, 10 * 1024 * 1024).catch(() => null);
        if (!listing || listing.code !== 0) { entry.archiveEnumerated = false; setOutcome(entry, { disposition: 'failed', reasonCode: 'ARCHIVE_UNREADABLE', reasonDetail: 'The archive could not be listed; its contents are unknown and were not extracted.', tool: EXTRACT_TOOL }); itemOutcome.set(item.id, 'FAILED'); continue; }
        const members = listing.stdout.toString('utf8').split(/\r?\n/).filter(Boolean);
        try { validateArchiveEntries(members); }
        catch (error) { entry.archiveEnumerated = false; setOutcome(entry, { disposition: 'failed', reasonCode: error instanceof Error ? error.message : 'REPOSITORY_PATH_INVALID', reasonDetail: 'The archive contains an entry that would escape the extraction directory or exceeds the entry limit; it was not extracted.', tool: EXTRACT_TOOL }); itemOutcome.set(item.id, 'FAILED'); continue; }
        const declared = await declaredArchiveSize(kind, archivePath);
        if (declared && (declared.bytes > MAX_EXTRACTED_BYTES || declared.entries > MAX_EXTRACTED_FILES)) {
          entry.archiveEnumerated = true;
          setOutcome(entry, { disposition: 'skipped', reasonCode: 'ARCHIVE_EXPANSION_LIMIT_EXCEEDED', reasonDetail: `The archive declares ${declared.entries} member(s) totalling ${declared.bytes} bytes, over the ${MAX_EXTRACTED_BYTES}-byte / ${MAX_EXTRACTED_FILES}-file extraction limit; it was listed but not extracted.`, inspectionLevel: 'listing', tool: EXTRACT_TOOL });
          for (const raw of members) {
            const posix = raw.replaceAll('\\', '/').replace(/^\/+/, '');
            if (!posix || posix.endsWith('/')) continue;
            if (entries.length >= 100_000) { limitations.push('INVENTORY_TRUNCATED: more than 100000 entries were listed; the inventory is a lower bound.'); break; }
            const member = newEntry(sequence++, `${display}/${posix}`, 'nested-archive', entry.sequence, 1);
            setOutcome(member, { disposition: 'inventoried', inspectionLevel: 'listing', reasonCode: 'ARCHIVE_MEMBER_NOT_EXTRACTED', reasonDetail: 'Listed inside an archive that exceeded the extraction limit; the member was not extracted, hashed or inspected.', tool: EXTRACT_TOOL });
            entries.push(member);
          }
          itemOutcome.set(item.id, 'COMPLETED_WITH_WARNINGS');
          continue;
        }
        const extractDir = path.join(scanRoot, display);
        await mkdir(extractDir, { recursive: true });
        const extraction = await runBounded(process.platform === 'win32' ? 'tar.exe' : (kind === 'zip' ? 'unzip' : 'tar'), process.platform === 'win32' ? ['-xf', archivePath, '-C', extractDir] : (kind === 'zip' ? ['-q', archivePath, '-d', extractDir] : ['-xf', archivePath, '-C', extractDir]), 60_000).catch(() => null);
        if (!extraction || extraction.code !== 0) { entry.archiveEnumerated = false; await rm(extractDir, { recursive: true, force: true }); setOutcome(entry, { disposition: 'failed', reasonCode: 'ARCHIVE_EXTRACTION_FAILED', reasonDetail: 'The archive listing was read but extraction failed; members were not inspected.', tool: EXTRACT_TOOL }); itemOutcome.set(item.id, 'FAILED'); continue; }
        try { await walkCount(extractDir); }
        catch (error) { entry.archiveEnumerated = false; await rm(extractDir, { recursive: true, force: true }); setOutcome(entry, { disposition: 'failed', reasonCode: error instanceof Error ? error.message : 'ARCHIVE_EXPANSION_LIMIT_EXCEEDED', reasonDetail: 'Extraction exceeded the expansion limit and was discarded; members were not inspected.', tool: EXTRACT_TOOL }); itemOutcome.set(item.id, 'FAILED'); continue; }
        entry.archiveEnumerated = true;
        setOutcome(entry, { disposition: 'inspected', inspectionStatus: 'inspected', inspectionLevel: 'extracted', tool: EXTRACT_TOOL });
        // Members: the listing is the discovery source (so a member that
        // vanished in extraction is still recorded), observed on disk below.
        for (const raw of members) {
          const posix = raw.replaceAll('\\', '/').replace(/^\/+/, '');
          if (!posix || posix.endsWith('/')) continue;
          if (entries.length >= 100_000) { limitations.push('INVENTORY_TRUNCATED: more than 100000 entries were listed; the inventory is a lower bound.'); break; }
          entries.push(newEntry(sequence++, `${display}/${posix}`, 'intake-upload', entry.sequence, 1));
        }
        itemOutcome.set(item.id, 'COMPLETED');
      } else {
        await writeFile(path.join(scanRoot, display), bytes);
        entry.size = bytes.length; entry.sha256 = digest;
        itemOutcome.set(item.id, 'COMPLETED');
      }
    }
    await observeExtractedEntries(scanRoot, entries.filter((e) => !(e.isArchive && e.depth === 0)));
    await enumerateNestedArchives(entries, makeArchiveLister(runBounded), { name: 'spr-archive-lister', version: '1', action: 'listing' }, { maxDepth: 2 });
    await persistInventory(pool, ledger, entries);
    await recomputeCoverage(pool, ledger, { inventoryComplete: limitations.length === 0, limitations });
    await pool.query(`UPDATE intake_scan_sources SET acquired_at=NOW() WHERE job_id=$1 AND tenant_id=$2`, [job.id, job.tenant_id]);
    await pool.query(`UPDATE agent_jobs SET progress=25, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [job.id, job.tenant_id]);
    await pool.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,'intake-scanner',$2,'Info')`, [job.id, `Acquired ${items.length} uploaded item(s); ${entries.length} file(s) inventoried.`]);
    log('intake_inventory_persisted', { items: items.length, files: entries.length });

    // 2. Catalog (Syft) and query OSV; the components become the passport SBOM.
    let cycloneDx: any = null; let components: Array<{ name: string; version?: string; ecosystem?: string; purl?: string }> = [];
    try {
      const generated = await generateRepositorySbom(scanRoot, await locateSyft());
      cycloneDx = generated.document; components = generated.components;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'SBOM_GENERATION_FAILED';
      if (code !== 'SBOM_EMPTY') throw error;
      cycloneDx = null; components = [];
      limitations.push('SBOM_EMPTY: the cataloger found no versioned dependency components in the uploaded files; no dependency vulnerability evidence exists for this scan.');
    }
    await pool.query(`UPDATE agent_jobs SET progress=55, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [job.id, job.tenant_id]);
    const osvComponents = components.filter((c) => c.version);
    const acquiredAt = new Date();
    const itemHashes = items.map((i) => i.sha256 || '').sort();
    const uploadHash = sha256(JSON.stringify(itemHashes));
    const descriptor = { source: 'upload', sessionId: source.session_id, itemCount: items.length, itemSha256: itemHashes, scanId: ledger.scanId };
    const descriptorHash = sha256(JSON.stringify(descriptor));
    const uploadEvidenceId = deterministicId('ev-upload', `${job.id}|${descriptorHash}`);
    const sbomEvidenceId = cycloneDx ? deterministicId('ev-sbom', `${job.id}|${sha256(JSON.stringify(cycloneDx))}`) : null;
    await pool.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,status,signer,timestamp,hash,raw_content,engine_id,scan_id) VALUES ($1,$2,$3,'Uploaded file set descriptor','Attestation',0,'OBSERVED','spr-intake',$4,$5,$6,'intake-scanner',$7) ON CONFLICT (id) DO NOTHING`, [uploadEvidenceId, job.tenant_id, job.passport_id, acquiredAt.toISOString(), `sha256:${descriptorHash}`, JSON.stringify(descriptor), ledger.scanId]);
    if (cycloneDx && sbomEvidenceId) {
      const payload = JSON.stringify({ format: 'CycloneDX JSON', componentCount: components.length, generator: `Syft ${SYFT_VERSION}` });
      await pool.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,status,signer,timestamp,hash,raw_content,engine_id,scan_id) VALUES ($1,$2,$3,'Syft CycloneDX SBOM summary','Build Log',0,'OBSERVED',$8,$4,$5,$6,'intake-scanner',$7) ON CONFLICT (id) DO NOTHING`, [sbomEvidenceId, job.tenant_id, job.passport_id, acquiredAt.toISOString(), `sha256:${sha256(payload)}`, payload, ledger.scanId, `Syft ${SYFT_VERSION}`]);
    }
    let passportAssociated = false;
    try {
      await pool.query(`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,overall_score,security_score,compliance_score,vendor_reputation_score,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES ($1,$2,$3,$4,$5,'Uploaded','Upload',NULL,NULL,NULL,NULL,'unverified',$6,$7,'Unknown',$8,$9,'[]','[]','[]') ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version,file_hash=EXCLUDED.file_hash,sbom=EXCLUDED.sbom,release_date=EXCLUDED.release_date,ai_summary=EXCLUDED.ai_summary,overall_score=NULL,security_score=NULL,compliance_score=NULL,vendor_reputation_score=NULL,verification_status='unverified' WHERE passports.tenant_id=$2`,
        [job.passport_id, job.tenant_id, ledger.clientId, `Upload ${acquiredAt.toISOString().slice(0, 10)}`, `upload-${uploadHash.slice(0, 12)}`, acquiredAt.toISOString().slice(0, 10), uploadHash, cycloneDx ? 'Uploaded files acquired and SBOM generated. Trust assessment remains pending.' : 'Uploaded files acquired; no versioned dependency components were found. Trust assessment remains pending.', JSON.stringify(osvComponents)]);
      passportAssociated = true;
      await recordPassportAssociation(pool, job.tenant_id, ledger.scanId, { ok: true });
      await appendAuditEntryViaPool(pool, { tenantId: job.tenant_id, action: 'passport.published', actor: 'intake-scanner', payload: { passportId: job.passport_id, jobId: job.id, scanId: ledger.scanId, version: `upload-${uploadHash.slice(0, 12)}` } });
    } catch (error) {
      const reason = safeFailureReason(rootErrorMessage(error));
      console.error(JSON.stringify({ event: 'passport_upsert_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, passportId: job.passport_id, scanId: ledger.scanId, reason }));
      await recordPassportAssociation(pool, job.tenant_id, ledger.scanId, { ok: false, failure: reason });
    }
    if (osvComponents.length > 0) await processJob(pool, { id: job.id, tenant_id: job.tenant_id, passport_id: job.passport_id, attempt_count: job.attempt_count, max_attempts: job.max_attempts, job_type: 'intake_scan', scan_id: ledger.scanId }, osvComponents);
    await pool.query(`UPDATE agent_jobs SET progress=80, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [job.id, job.tenant_id]);

    // 3. Content engines over the extracted tree.
    const scanned = await runRealRepositoryScanners(scanRoot, cycloneDx ?? { bomFormat: 'CycloneDX', components: [] });
    const persistedFindings: Array<{ id: string; filePath: string | null }> = [];
    for (const finding of scanned.findings) {
      const findingId = `finding-${sha256(scanFindingIdentity({ tenantId: job.tenant_id, passportId: job.passport_id, engineId: finding.engineId, category: finding.category, title: finding.title, component: finding.component }))}`;
      await pool.query(`INSERT INTO scan_findings (id,tenant_id,asset_id,job_id,severity,category,title,description,component,status,detected_at,engine_id,file_path,scan_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Open',NOW(),$10,$11,$12) ON CONFLICT (id) DO UPDATE SET file_path = COALESCE(scan_findings.file_path, EXCLUDED.file_path), scan_id = COALESCE(scan_findings.scan_id, EXCLUDED.scan_id)`, [findingId, job.tenant_id, job.passport_id, job.id, finding.severity, finding.category, finding.title, finding.description, finding.component || null, finding.engineId, finding.filePath ?? null, ledger.scanId]);
      persistedFindings.push({ id: findingId, filePath: finding.filePath ?? null });
    }
    const securityPayload = JSON.stringify({ source: 'upload', sessionId: source.session_id, engines: ['Syft', 'OSV', 'spr-secret-scanner-v1', 'spr-iac-config-scanner-v1', 'spr-license-scanner-v1'], findingCount: scanned.findings.length, filesOffered: scanned.filesOffered, limitations: ['OSV results are provider observations, not cryptographic verification.', 'Secret/config rules are deterministic pattern scanners and can produce false positives/negatives.', ...limitations] });
    const securityEvidenceId = `ev-security-${job.id}-${sha256(securityPayload).slice(0, 24)}`;
    await pool.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,status,signer,timestamp,hash,raw_content,engine_id,scan_id) VALUES ($1,$2,$3,'Multi-engine uploaded-file security scan','Security Scan',0,'OBSERVED','SPR scanner',NOW(),$4,$5,'spr-security-orchestrator-v1',$6) ON CONFLICT DO NOTHING`, [securityEvidenceId, job.tenant_id, job.passport_id, `sha256:${sha256(securityPayload)}`, securityPayload, ledger.scanId]);

    // 4. Every engine's outcome onto the inventory, then the final accounting.
    applyContentInspection(entries, scanned.inspectionReports);
    if (cycloneDx) applyCatalogLocations(entries, cycloneDx, SYFT_TOOL(SYFT_VERSION));
    const byPath = new Map<string, InventoryEntry[]>();
    for (const entry of entries) { const list = byPath.get(entry.path) ?? []; list.push(entry); byPath.set(entry.path, list); }
    for (const finding of persistedFindings) { if (!finding.filePath) continue; for (const entry of byPath.get(finding.filePath) ?? []) if (!entry.relatedFindingIds.includes(finding.id)) entry.relatedFindingIds.push(finding.id); }
    for (const entry of entries) {
      if (entry.depth === 0 && !entry.relatedEvidenceIds.includes(uploadEvidenceId)) entry.relatedEvidenceIds.push(uploadEvidenceId);
      if (sbomEvidenceId && entry.analysisStatus === 'analyzed' && !entry.relatedEvidenceIds.includes(sbomEvidenceId)) entry.relatedEvidenceIds.push(sbomEvidenceId);
      if (entry.inspectionStatus === 'inspected' && entry.inspectionLevel?.includes('content') && !entry.relatedEvidenceIds.includes(securityEvidenceId)) entry.relatedEvidenceIds.push(securityEvidenceId);
    }
    finalizeDispositions(entries, { contentUnsupportedReason: (entry) => entry.source === 'nested-archive' || (entry.isArchive && entry.depth === 0) ? null : contentUnsupportedReason(entry.path), contentInspectionRan: true });
    await persistInventory(pool, ledger, entries);
    const coverage = await recomputeCoverage(pool, ledger, { inventoryComplete: !limitations.some((l) => l.startsWith('INVENTORY_TRUNCATED')), limitations });
    log('scan_coverage_computed', { filesDiscovered: coverage.filesDiscovered, filesInspected: coverage.filesInspected, filesAnalyzed: coverage.filesAnalyzed, filesUnsupported: coverage.filesUnsupported, filesSkipped: coverage.filesSkipped, filesFailed: coverage.filesFailed, filesInaccessible: coverage.filesInaccessible, filesUnknown: coverage.filesUnknown });

    for (const item of items) {
      const outcome = itemOutcome.get(item.id) ?? 'FAILED';
      await pool.query(`UPDATE intake_items SET status=$3 WHERE id=$1 AND tenant_id=$2`, [item.id, job.tenant_id, outcome]);
    }
    await pool.query(`UPDATE intake_sessions SET status='CLOSED' WHERE id=$1 AND tenant_id=$2`, [source.session_id, job.tenant_id]);
    await pool.query(`UPDATE agent_jobs SET status='Completed',progress=100,result=$2,error=NULL,completed_at=NOW(),locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1 AND tenant_id=$3 AND status='Running' AND locked_by=$4`, [job.id, JSON.stringify({ items: items.length, files: entries.length, componentsQueried: osvComponents.length, findings: scanned.findings.length, passportAssociated, limitations }), job.tenant_id, WORKER_ID]);
    await pool.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,'intake-scanner',$2,'Info')`, [job.id, `Completed: ${entries.length} file(s) accounted for, ${coverage.filesInspected} inspected, ${coverage.filesAnalyzed} catalogued, ${scanned.findings.length} content finding(s).`]);
    if (passportAssociated) {
      try {
        const score = await calculateAndStoreTrustScore(job.passport_id, job.tenant_id, { pool });
        log('passport_scored', { verificationStatus: score.verificationStatus, overallScore: score.overallScore, evidenceCount: score.evidenceCount, findingsCount: score.findingsCount });
      } catch (error) { console.error(JSON.stringify({ event: 'passport_score_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, passportId: job.passport_id, scanId: ledger.scanId, reason: safeFailureReason(rootErrorMessage(error)) })); }
    }
  } catch (error: any) {
    // Whatever was inventoried before the failure stays persisted; the
    // failure is recorded on the source and the job, never by deleting rows.
    if (entries.length > 0) {
      try { await persistInventory(pool, ledger, entries); await recomputeCoverage(pool, ledger, { inventoryComplete: false, limitations: [`SCAN_FAILED: ${safeFailureReason(rootErrorMessage(error))}`] }); } catch (persistError) { console.error(JSON.stringify({ event: 'intake_inventory_persist_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, scanId: ledger.scanId, reason: safeFailureReason(rootErrorMessage(persistError)) })); }
    }
    await pool.query(`UPDATE intake_scan_sources SET scanner_error_category=$2 WHERE job_id=$1 AND tenant_id=$3`, [job.id, String(error?.message || 'INTAKE_SCAN_FAILED').slice(0, 100), job.tenant_id]);
    throw error;
  } finally {
    try { await rm(tempRoot, { recursive: true, force: true }); cleanupSucceeded = true; } finally {
      await pool.query('UPDATE intake_scan_sources SET temporary_directory_removed=$2 WHERE job_id=$1 AND tenant_id=$3', [job.id, cleanupSucceeded ? 1 : 0, job.tenant_id]);
    }
  }
}

const DETERMINISTIC_TERMINAL = new Set(['INTAKE_SESSION_EMPTY', 'INTAKE_SOURCE_NOT_FOUND', 'SCAN_RUN_NOT_FOUND', 'SBOM_INVALID', 'SBOM_MALFORMED', 'REPOSITORY_TOO_LARGE', 'REPOSITORY_FILE_LIMIT_EXCEEDED']);

async function fail(pool: Pool, job: any, error: unknown) {
  const code = error instanceof Error ? error.message : 'INTAKE_SCAN_ERROR';
  const attempt = Number(job.attempt_count);
  const terminal = DETERMINISTIC_TERMINAL.has(code);
  const retry = !terminal && attempt < Number(job.max_attempts);
  const next = retry ? Math.min(60 * Math.pow(2, Math.max(0, attempt - 1)), 3600) : 0;
  console.error(JSON.stringify({ event: 'intake_scan_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, scanId: job.scan_id, attempt, maxAttempts: Number(job.max_attempts), willRetry: retry, terminal, reason: safeFailureReason(code) }));
  await pool.query(`UPDATE agent_jobs SET status=$2,progress=CASE WHEN $2='Failed' THEN 100 ELSE progress END,error=$3,next_attempt_at=CASE WHEN $2='Pending' THEN NOW()+($4 * INTERVAL '1 second') ELSE next_attempt_at END,locked_at=NULL,locked_by=NULL,completed_at=CASE WHEN $2='Failed' THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=$1 AND tenant_id=$5 AND locked_by=$6`, [job.id, retry ? 'Pending' : 'Failed', code.slice(0, 200), next, job.tenant_id, WORKER_ID]);
  if (!retry) {
    const source = (await pool.query('SELECT session_id FROM intake_scan_sources WHERE job_id=$1 AND tenant_id=$2', [job.id, job.tenant_id])).rows[0];
    if (source) await pool.query(`UPDATE intake_items SET status='FAILED' WHERE session_id=$1 AND tenant_id=$2 AND status IN ('QUEUED','PROCESSING','UPLOADED')`, [source.session_id, job.tenant_id]);
  }
}

export async function runIntakeScannerOnce(pool: Pool) {
  const job = await claimJob(pool);
  if (!job) return false;
  try { await processIntakeJob(pool, job); } catch (error) { await fail(pool, job, error); }
  if (job.scan_id) {
    try { const status = await settleScanRun(pool, job.tenant_id, job.scan_id); console.log(JSON.stringify({ event: 'scan_run_settled', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, scanId: job.scan_id, status })); }
    catch (error) { console.error(JSON.stringify({ event: 'scan_run_settle_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, scanId: job.scan_id, reason: safeFailureReason(rootErrorMessage(error)) })); }
  }
  return true;
}

export async function runIntakeScannerLoop() {
  const pool = createWorkerPool();
  await assertWorkerDatabase(pool);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(JSON.stringify({ event: 'intake_scanner_started', workerId: WORKER_ID }));
  try { while (!stopping) { const processed = await runIntakeScannerOnce(pool); if (!processed) await new Promise((resolve) => setTimeout(resolve, 2000)); } }
  finally { await pool.end(); }
}

