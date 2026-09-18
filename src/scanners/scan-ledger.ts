/**
 * Persistence for the scan ledger (the durable scans row), the per-file inventory
 * (scan_file_inventory) and the coverage accounting (scan_coverage).
 *
 * Every write here is idempotent under retry: inventory rows are keyed by
 * (scan_id, sequence) and merged with rank rules, coverage is recomputed
 * from the persisted rows rather than accumulated, and status transitions are
 * derived from the jobs' recorded states. A worker that crashes half-way and
 * re-runs produces the same rows, not duplicates.
 */
import crypto from 'node:crypto';
import { ANALYSIS_RANK, computeCoverage, DISPOSITION_RANK, INSPECTION_RANK, type CoverageRow, type CoverageSummary, type InventoryEntry } from './file-inventory.ts';

export interface Queryable { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

export interface LedgerContext { tenantId: string; scanId: string; passportId: string; clientId: string | null }

const DISPOSITION_ORDER = Object.entries(DISPOSITION_RANK).sort((a, b) => a[1] - b[1]).map(([name]) => name);
const INSPECTION_ORDER = Object.entries(INSPECTION_RANK).sort((a, b) => a[1] - b[1]).map(([name]) => name);
const ANALYSIS_ORDER = Object.entries(ANALYSIS_RANK).sort((a, b) => a[1] - b[1]).map(([name]) => name);
const INVENTORY_BATCH = 400;

const sqlArray = (values: string[]) => `ARRAY[${values.map((v) => `'${v}'`).join(',')}]::text[]`;
const rankMerge = (column: string, order: string[]) => `CASE WHEN array_position(${sqlArray(order)}, EXCLUDED.${column}) > array_position(${sqlArray(order)}, scan_file_inventory.${column}) THEN EXCLUDED.${column} ELSE scan_file_inventory.${column} END`;
const jsonUnion = (column: string) => `(SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb) FROM jsonb_array_elements(scan_file_inventory.${column} || EXCLUDED.${column}) e)`;

export function inventoryRowId(scanId: string, sequence: number): string {
  return `file_${crypto.createHash('sha256').update(`${scanId}|${sequence}`).digest('hex').slice(0, 40)}`;
}

/** Upserts the given entries for a scan run, merging with any contribution another job already persisted for the same file. */
export async function persistInventory(db: Queryable, ctx: LedgerContext, entries: InventoryEntry[]): Promise<number> {
  let written = 0;
  const columns = ['id', 'tenant_id', 'scan_id', 'passport_id', 'client_id', 'parent_file_id', 'depth', 'sequence', 'path', 'filename', 'extension', 'detected_type', 'detection_method', 'category', 'size', 'sha256', 'source', 'is_archive', 'archive_enumerated', 'disposition', 'inspection_status', 'analysis_status', 'inspection_level', 'tools', 'reason_code', 'reason_detail', 'notes', 'related_components', 'related_finding_ids', 'related_evidence_ids'];
  for (let offset = 0; offset < entries.length; offset += INVENTORY_BATCH) {
    const batch = entries.slice(offset, offset + INVENTORY_BATCH);
    const values: unknown[] = [];
    const tuples = batch.map((entry) => {
      const row = [
        inventoryRowId(ctx.scanId, entry.sequence), ctx.tenantId, ctx.scanId, ctx.passportId, ctx.clientId,
        entry.parentSequence === null ? null : inventoryRowId(ctx.scanId, entry.parentSequence), entry.depth, entry.sequence,
        entry.path.slice(0, 4000), entry.filename.slice(0, 1000), entry.extension, entry.detectedType, entry.detectionMethod, entry.category,
        entry.size, entry.sha256, entry.source, entry.isArchive ? 1 : 0, entry.archiveEnumerated === null ? null : (entry.archiveEnumerated ? 1 : 0), entry.disposition, entry.inspectionStatus, entry.analysisStatus, entry.inspectionLevel,
        JSON.stringify(entry.tools), entry.reasonCode, entry.reasonDetail ? entry.reasonDetail.slice(0, 1000) : null, JSON.stringify(entry.notes.slice(0, 50)),
        JSON.stringify(entry.relatedComponents), JSON.stringify(entry.relatedFindingIds), JSON.stringify(entry.relatedEvidenceIds),
      ];
      const placeholders = row.map((value, index) => { values.push(value); const n = values.length; return ['tools', 'notes', 'related_components', 'related_finding_ids', 'related_evidence_ids'].includes(columns[index]) ? `$${n}::jsonb` : `$${n}`; });
      return `(${placeholders.join(',')})`;
    });
    const result = await db.query(`
      INSERT INTO scan_file_inventory (${columns.join(',')}) VALUES ${tuples.join(',')}
      ON CONFLICT (scan_id, sequence) DO UPDATE SET
        size = COALESCE(EXCLUDED.size, scan_file_inventory.size),
        sha256 = COALESCE(EXCLUDED.sha256, scan_file_inventory.sha256),
        detected_type = CASE WHEN EXCLUDED.detection_method = 'magic' OR scan_file_inventory.detection_method = 'none' THEN EXCLUDED.detected_type ELSE scan_file_inventory.detected_type END,
        detection_method = CASE WHEN EXCLUDED.detection_method = 'magic' OR scan_file_inventory.detection_method = 'none' THEN EXCLUDED.detection_method ELSE scan_file_inventory.detection_method END,
        category = CASE WHEN scan_file_inventory.category = 'unknown' THEN EXCLUDED.category ELSE scan_file_inventory.category END,
        is_archive = GREATEST(scan_file_inventory.is_archive, EXCLUDED.is_archive),
        archive_enumerated = COALESCE(EXCLUDED.archive_enumerated, scan_file_inventory.archive_enumerated),
        disposition = ${rankMerge('disposition', DISPOSITION_ORDER)},
        inspection_status = ${rankMerge('inspection_status', INSPECTION_ORDER)},
        analysis_status = ${rankMerge('analysis_status', ANALYSIS_ORDER)},
        inspection_level = CASE
          WHEN scan_file_inventory.inspection_level IS NULL THEN EXCLUDED.inspection_level
          WHEN EXCLUDED.inspection_level IS NULL OR scan_file_inventory.inspection_level = EXCLUDED.inspection_level OR position(EXCLUDED.inspection_level in scan_file_inventory.inspection_level) > 0 THEN scan_file_inventory.inspection_level
          ELSE scan_file_inventory.inspection_level || '+' || EXCLUDED.inspection_level END,
        tools = ${jsonUnion('tools')},
        notes = ${jsonUnion('notes')},
        related_components = ${jsonUnion('related_components')},
        related_finding_ids = ${jsonUnion('related_finding_ids')},
        related_evidence_ids = ${jsonUnion('related_evidence_ids')},
        reason_code = CASE WHEN array_position(${sqlArray(DISPOSITION_ORDER)}, EXCLUDED.disposition) > array_position(${sqlArray(DISPOSITION_ORDER)}, scan_file_inventory.disposition) THEN EXCLUDED.reason_code ELSE scan_file_inventory.reason_code END,
        reason_detail = CASE WHEN array_position(${sqlArray(DISPOSITION_ORDER)}, EXCLUDED.disposition) > array_position(${sqlArray(DISPOSITION_ORDER)}, scan_file_inventory.disposition) THEN EXCLUDED.reason_detail ELSE scan_file_inventory.reason_detail END,
        updated_at = CURRENT_TIMESTAMP
      WHERE scan_file_inventory.path = EXCLUDED.path AND scan_file_inventory.tenant_id = EXCLUDED.tenant_id
    `, values);
    written += result.rowCount ?? batch.length;
  }
  return written;
}

/** Records finding ids against the inventory rows for their file paths (used after findings are persisted). */
export async function linkFindingsToInventory(db: Queryable, ctx: LedgerContext, findings: Array<{ id: string; filePath: string | null }>): Promise<void> {
  const byPath = new Map<string, string[]>();
  for (const finding of findings) {
    if (!finding.filePath) continue;
    const list = byPath.get(finding.filePath) ?? [];
    if (!list.includes(finding.id)) list.push(finding.id);
    byPath.set(finding.filePath, list);
  }
  for (const [filePath, ids] of byPath) {
    await db.query(`
      UPDATE scan_file_inventory SET related_finding_ids = (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb) FROM jsonb_array_elements(related_finding_ids || $4::jsonb) e), updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND scan_id = $2 AND path = $3
    `, [ctx.tenantId, ctx.scanId, filePath, JSON.stringify(ids)]);
  }
}

export async function loadCoverageRows(db: Queryable, tenantId: string, scanId: string): Promise<CoverageRow[]> {
  const rows: CoverageRow[] = [];
  const pageSize = 5000;
  let after = -1;
  for (;;) {
    const result = await db.query(`
      SELECT sequence, disposition, inspection_status, analysis_status, category, source, is_archive, archive_enumerated,
             jsonb_array_length(related_finding_ids) > 0 AS has_findings,
             jsonb_array_length(related_evidence_ids) > 0 AS has_evidence
      FROM scan_file_inventory WHERE tenant_id = $1 AND scan_id = $2 AND sequence > $3 ORDER BY sequence LIMIT $4
    `, [tenantId, scanId, after, pageSize]);
    for (const row of result.rows) {
      rows.push({ disposition: row.disposition, inspectionStatus: row.inspection_status, analysisStatus: row.analysis_status, category: row.category, source: row.source, isArchive: Number(row.is_archive) === 1, archiveEnumerated: row.archive_enumerated === null || row.archive_enumerated === undefined ? null : Number(row.archive_enumerated) === 1, hasFindings: Boolean(row.has_findings), hasEvidence: Boolean(row.has_evidence) });
      after = Number(row.sequence);
    }
    if (result.rows.length < pageSize) break;
  }
  return rows;
}

/** Recomputes and stores the coverage for a scan run from its persisted inventory rows. */
export async function recomputeCoverage(db: Queryable, ctx: LedgerContext, options: { inventoryComplete: boolean; limitations: string[] }): Promise<CoverageSummary> {
  const rows = await loadCoverageRows(db, ctx.tenantId, ctx.scanId);
  const existing = (await db.query('SELECT inventory_complete, limitations FROM scan_coverage WHERE scan_id = $1 AND tenant_id = $2', [ctx.scanId, ctx.tenantId])).rows[0];
  const previousLimitations: string[] = Array.isArray(existing?.limitations) ? existing.limitations : [];
  const inventoryComplete = options.inventoryComplete && (existing ? Number(existing.inventory_complete) === 1 : true);
  const limitations = [...new Set([...previousLimitations.filter((l) => !String(l).startsWith('INVENTORY_TRUNCATED')), ...options.limitations])];
  const summary = computeCoverage(rows, { inventoryComplete, limitations });
  await db.query(`
    INSERT INTO scan_coverage (scan_id, tenant_id, passport_id, files_discovered, files_accounted_for, files_inspected, files_partially_inspected, files_analyzed, files_unsupported, files_skipped, files_failed, files_inaccessible, files_unknown, files_with_findings, files_without_findings, files_with_evidence, archives_discovered, archives_enumerated, archives_unreadable, inspection_applicable, analysis_applicable, accounting_coverage_pct, inspection_coverage_pct, analysis_coverage_pct, evidence_coverage_pct, inventory_complete, limitations, computed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,CURRENT_TIMESTAMP)
    ON CONFLICT (scan_id) DO UPDATE SET
      files_discovered = EXCLUDED.files_discovered, files_accounted_for = EXCLUDED.files_accounted_for, files_inspected = EXCLUDED.files_inspected, files_partially_inspected = EXCLUDED.files_partially_inspected, files_analyzed = EXCLUDED.files_analyzed,
      files_unsupported = EXCLUDED.files_unsupported, files_skipped = EXCLUDED.files_skipped, files_failed = EXCLUDED.files_failed, files_inaccessible = EXCLUDED.files_inaccessible, files_unknown = EXCLUDED.files_unknown,
      files_with_findings = EXCLUDED.files_with_findings, files_without_findings = EXCLUDED.files_without_findings, files_with_evidence = EXCLUDED.files_with_evidence,
      archives_discovered = EXCLUDED.archives_discovered, archives_enumerated = EXCLUDED.archives_enumerated, archives_unreadable = EXCLUDED.archives_unreadable,
      inspection_applicable = EXCLUDED.inspection_applicable, analysis_applicable = EXCLUDED.analysis_applicable,
      accounting_coverage_pct = EXCLUDED.accounting_coverage_pct, inspection_coverage_pct = EXCLUDED.inspection_coverage_pct, analysis_coverage_pct = EXCLUDED.analysis_coverage_pct, evidence_coverage_pct = EXCLUDED.evidence_coverage_pct,
      inventory_complete = EXCLUDED.inventory_complete, limitations = EXCLUDED.limitations, computed_at = CURRENT_TIMESTAMP
  `, [ctx.scanId, ctx.tenantId, ctx.passportId, summary.filesDiscovered, summary.filesAccountedFor, summary.filesInspected, summary.filesPartiallyInspected, summary.filesAnalyzed, summary.filesUnsupported, summary.filesSkipped, summary.filesFailed, summary.filesInaccessible, summary.filesUnknown, summary.filesWithFindings, summary.filesWithoutFindings, summary.filesWithEvidence, summary.archivesDiscovered, summary.archivesEnumerated, summary.archivesUnreadable, summary.inspectionApplicable, summary.analysisApplicable, summary.accountingCoveragePct, summary.inspectionCoveragePct, summary.analysisCoveragePct, summary.evidenceCoveragePct, summary.inventoryComplete ? 1 : 0, JSON.stringify(summary.limitations)]);
  return summary;
}

/** Pins the commit both halves of a repository scan examine. Returns the pinned SHA (the caller's, or the one another job pinned first). */
export async function pinScanCommit(db: Queryable, tenantId: string, scanId: string, commitSha: string): Promise<string> {
  const result = await db.query(`UPDATE scans SET resolved_commit_sha = COALESCE(resolved_commit_sha, $3), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING resolved_commit_sha`, [scanId, tenantId, commitSha.toLowerCase()]);
  return String(result.rows[0]?.resolved_commit_sha ?? commitSha).toLowerCase();
}

export type ScanStatus = 'Queued' | 'Scanning' | 'Completed' | 'Partial' | 'Failed';

export async function markScanRunRunning(db: Queryable, tenantId: string, scanId: string): Promise<void> {
  await db.query(`UPDATE scans SET status = CASE WHEN status IN ('Queued', 'Pending') THEN 'Scanning' ELSE status END, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [scanId, tenantId]);
}

export async function recordPassportAssociation(db: Queryable, tenantId: string, scanId: string, outcome: { ok: true } | { ok: false; failure: string }): Promise<void> {
  if (outcome.ok) await db.query(`UPDATE scans SET passport_status = 'associated', passport_failure = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [scanId, tenantId]);
  else await db.query(`UPDATE scans SET passport_status = 'failed', passport_failure = $3, error_state = COALESCE(error_state, 'passport_update_failed'), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [scanId, tenantId, outcome.failure.slice(0, 500)]);
}

/**
 * Derives the scan's status from its jobs' recorded states. Called after any
 * job finishes or fails; safe to call repeatedly. A scan is 'Completed' only
 * when every job it owns completed, 'Partial' when at least one did and one
 * failed terminally, 'Failed' when none succeeded and none is still pending.
 * coverage_state is set from the persisted coverage row, never assumed.
 */
export async function settleScanRun(db: Queryable, tenantId: string, scanId: string): Promise<ScanStatus> {
  const jobs = (await db.query(`SELECT id, status, error, attempt_count, max_attempts FROM agent_jobs WHERE scan_id = $1 AND tenant_id = $2`, [scanId, tenantId])).rows as Array<{ id: string; status: string; error: string | null; attempt_count: number; max_attempts: number }>;
  if (jobs.length === 0) return 'Queued';
  const completed = jobs.filter((j) => j.status === 'Completed');
  const failed = jobs.filter((j) => j.status === 'Failed');
  const open = jobs.filter((j) => j.status === 'Pending' || j.status === 'Running');
  let status: ScanStatus;
  if (open.length > 0) status = completed.length > 0 || jobs.some((j) => j.status === 'Running' || Number(j.attempt_count) > 0) ? 'Scanning' : 'Queued';
  else if (failed.length === 0) status = 'Completed';
  else if (completed.length > 0) status = 'Partial';
  else status = 'Failed';
  const failureCode = failed.map((j) => j.error).filter(Boolean)[0] ?? null;
  const terminal = open.length === 0;
  // Job completion is not equivalent to truthful scan completion. A scanner job
  // can finish after producing a persisted partial/failed inventory. Settlement
  // must therefore consult the durable coverage record before ever returning
  // Completed.
  const coverage = (await db.query(`SELECT inventory_complete, files_failed, files_inaccessible, files_partially_inspected, files_unknown, limitations FROM scan_coverage WHERE scan_id = $1 AND tenant_id = $2`, [scanId, tenantId])).rows[0];
  const coverageHasFailure = coverage && (
    Number(coverage.files_failed ?? 0) > 0 ||
    Number(coverage.files_inaccessible ?? 0) > 0
  );
  const coverageIsPartial = coverage && (
    Number(coverage.files_partially_inspected ?? 0) > 0 ||
    Number(coverage.files_unknown ?? 0) > 0 ||
    Number(coverage.inventory_complete) !== 1
  );
  if (terminal && failed.length === 0 && (coverageHasFailure || coverageIsPartial)) {
    status = 'Partial';
  }
  const current = (await db.query(`SELECT source, started_at, created_at, completed_at FROM scans WHERE id = $1 AND tenant_id = $2`, [scanId, tenantId])).rows[0];
  const coverageState = coverage ? (Number(coverage.inventory_complete) === 1 ? 'inventory_complete' : 'inventory_truncated') : current?.source === 'sbom' ? 'no_inventory' : terminal ? 'no_inventory' : 'unknown';
  const findings = terminal ? Number((await db.query(`SELECT COUNT(*)::int AS findings FROM scan_findings WHERE tenant_id = $1 AND scan_id = $2`, [tenantId, scanId])).rows[0]?.findings ?? 0) : null;
  const startedAt = current?.started_at ? new Date(current.started_at).getTime() : (current?.created_at ? new Date(current.created_at).getTime() : Date.now());
  await db.query(`
    UPDATE scans SET
      status = $3,
      error_code = CASE WHEN $5 THEN $4 ELSE NULL END,
      error_state = CASE WHEN $5 AND $4 IS NOT NULL THEN COALESCE(error_state, 'job_failed') WHEN $5 THEN error_state ELSE NULL END,
      completed_at = CASE WHEN $5 THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
      findings_count = CASE WHEN $5 THEN $6 ELSE findings_count END,
      duration_ms = CASE WHEN $5 THEN GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(completed_at, CURRENT_TIMESTAMP))) * 1000)::bigint - $7::bigint)::integer ELSE duration_ms END,
      coverage_state = $8,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2
  `, [scanId, tenantId, status, terminal ? failureCode : null, terminal, findings, startedAt, coverageState]);
  return status;
}

export function newScanId() { return `scan_${crypto.randomUUID().replace(/-/g, '')}`; }
