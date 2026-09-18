/**
 * The scan ledger API: where a customer answers "what did I submit, what did
 * SPR inspect, what could it not inspect, what did it find, what evidence
 * supports that, which passport did it update, what changed since last time,
 * and where is my scan". Everything served here is read from persisted rows;
 * nothing is computed from what a scan was expected to do.
 *
 * Every route is tenant-scoped through req.db (RLS) and additionally checks
 * the passport's client for Client-role users. Inventories can run to tens of
 * thousands of rows, so every list is paginated and filtered server-side.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { appendAuditEntry } from '../security/audit-log.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { db as ownerDb } from '../db/index.ts';
import { enqueueRepositoryScan, enqueueUploadScan } from '../scanners/scan-submission.ts';

const page = z.coerce.number().int().min(1).max(100_000).default(1);
const limit = z.coerce.number().int().min(1).max(500).default(50);
const optionalId = z.string().min(1).max(200).optional();

const submitSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('github'),
    owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    ref: z.string().min(1).max(200).optional(),
    subdirectory: z.string().max(500).default(''),
    passportId: optionalId,
    clientId: optionalId,
    name: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  z.object({
    source: z.literal('upload'),
    sessionId: z.string().regex(/^intake_[a-f0-9]{32}$/),
    passportId: optionalId,
    clientId: optionalId,
    name: z.string().trim().min(1).max(200).optional(),
  }).strict(),
]);

const listSchema = z.object({ passportId: optionalId, clientId: optionalId, status: z.enum(['Queued', 'Scanning', 'Completed', 'Partial', 'Failed']).optional(), sourceKind: z.enum(['github', 'upload', 'sbom']).optional(), q: z.string().max(200).optional(), page, limit });
const filesSchema = z.object({
  disposition: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
  category: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
  inspection: z.enum(['inspected', 'partial', 'not_inspected', 'failed']).optional(),
  analysis: z.enum(['analyzed', 'not_analyzed', 'failed']).optional(),
  withFindings: z.enum(['true', 'false']).optional(),
  withEvidence: z.enum(['true', 'false']).optional(),
  parent: z.string().max(200).optional(),
  q: z.string().max(300).optional(),
  page, limit,
});
const findingsSchema = z.object({ severity: z.string().regex(/^[a-z]+(,[a-z]+)*$/i).optional(), status: z.string().max(50).optional(), category: z.string().max(50).optional(), engine: z.string().max(80).optional(), filePath: z.string().max(4000).optional(), page, limit });
const pagedSchema = z.object({ page, limit });

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }
function rows(result: unknown): any[] { return ((result as any)?.rows ?? []) as any[]; }
function csv(value: string | undefined) { return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : []; }

const COVERAGE_DEFINITIONS = {
  accounting: 'files_accounted_for / files_discovered. 100% means every file SPR discovered carries an explicit disposition. Below 100% only when the discovery source was truncated (inventory_complete = false).',
  inspection: 'files_inspected / inspection_applicable. Applicable = every discovered file except types no SPR engine reads (unsupported) and members listed inside nested archives (listing only). Skipped, failed, inaccessible and unknown files count against this ratio.',
  analysis: 'files_analyzed / analysis_applicable. Applicable = dependency manifests, lockfiles, packages and SBOMs, plus any file a cataloger actually parsed. Analyzed means a cataloger named the file as the location it extracted components from.',
  evidence: 'files_with_evidence / files_discovered. A file counts when a persisted finding or evidence record references it.',
  rule: 'These four ratios are independent and are never combined into one score. A file with no finding is not the same as a file that was inspected.',
};

export function createScanLedgerRouter() {
  const router = Router();
  router.use('/scans/submit', requireAuth);
  router.use('/scans/runs', requireAuth);
  router.use('/passports/:passportId/scan-history', requireAuth);

  /** Loads a run the caller may see, or null. Client-role users only see runs on their own client's passports. */
  async function loadRun(req: AuthenticatedRequest, runId: string) {
    const clientScope = req.user!.role === 'Client' ? req.user!.clientId ?? '' : null;
    const result = await req.db!.execute(sql`
      SELECT r.id, r.tenant_id AS "tenantId", r.client_id AS "clientId", r.passport_id AS "passportId", r.source AS "sourceKind", r.source_ref AS "sourceRef", r.resolved_commit_sha AS "resolvedCommitSha",
             r.status, r.job_id AS "repositoryJobId", r.worker_job_id AS "securityJobId", r.intake_job_id AS "intakeJobId", r.intake_session_id AS "intakeSessionId", r.triggered_by AS "triggeredBy",
             r.error_code AS "failureCode", r.error_state AS "errorState", r.coverage_state AS "coverageState", r.target_name AS "targetName", r.scan_type AS "scanType", r.passport_status AS "passportStatus", r.passport_failure AS "passportFailure", r.created_at AS "createdAt", r.started_at AS "startedAt", r.completed_at AS "completedAt", r.updated_at AS "updatedAt",
             p.name AS "passportName", p.version AS "passportVersion", p.verification_status AS "passportVerificationStatus", p.client_id AS "passportClientId", c.name AS "clientName"
      FROM scans r
      LEFT JOIN passports p ON p.id = r.passport_id AND p.tenant_id = r.tenant_id
      LEFT JOIN clients c ON c.id = COALESCE(r.client_id, p.client_id) AND c.tenant_id = r.tenant_id
      WHERE r.id = ${runId} AND r.tenant_id = ${req.user!.tenantId}
        AND (${clientScope}::text IS NULL OR COALESCE(r.client_id, p.client_id) = ${clientScope})
      LIMIT 1`);
    return rows(result)[0] ?? null;
  }

  router.post('/scans/submit', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const input = parsed.data;
      const tenantId = req.user!.tenantId;
      const scoped = req.db!;
      let clientId: string | null = input.clientId ?? null;
      let clientName = 'Unassigned';
      if (clientId) {
        const client = rows(await scoped.execute(sql`SELECT id, name FROM clients WHERE id=${clientId} AND tenant_id=${tenantId} LIMIT 1`))[0];
        if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
        clientName = client.name;
      }
      // The software identity the scan will update. An existing passport is
      // used as-is; otherwise one is created now, before processing, so the
      // scan is associated with it from its first moment.
      let passport: { id: string; name: string; client_id: string | null } | null = null;
      if (input.passportId) {
        passport = rows(await scoped.execute(sql`SELECT id, name, client_id FROM passports WHERE id=${input.passportId} AND tenant_id=${tenantId} LIMIT 1`))[0] ?? null;
        if (!passport) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
        if (clientId && passport.client_id && passport.client_id !== clientId) return res.status(409).json({ error: 'PASSPORT_BELONGS_TO_ANOTHER_CLIENT' });
        if (!clientId && passport.client_id) {
          clientId = passport.client_id;
          clientName = rows(await scoped.execute(sql`SELECT name FROM clients WHERE id=${clientId} AND tenant_id=${tenantId} LIMIT 1`))[0]?.name ?? clientName;
        }
      }
      if (input.source === 'github') {
        const name = input.name ?? `${input.owner}/${input.repository}`;
        if (!passport) {
          const existing = rows(await scoped.execute(sql`SELECT id, name, client_id FROM passports WHERE tenant_id=${tenantId} AND LOWER(name)=LOWER(${name}) AND (${clientId}::text IS NULL OR client_id = ${clientId}) ORDER BY release_date DESC LIMIT 1`))[0];
          if (existing) passport = existing;
          else {
            const passportId = id('passport');
            await scoped.execute(sql`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES (${passportId},${tenantId},${clientId},${name},'pending',${input.owner},'Repository','unverified',${new Date().toISOString().slice(0, 10)},'pending','Unknown','Scan queued; no evidence has been observed yet.','[]','[]','[]','[]')`);
            passport = { id: passportId, name, client_id: clientId };
          }
        }
        const target = passport!;
        const submitted = await enqueueRepositoryScan(scoped, { tenantId, clientId, passportId: target.id, owner: input.owner, repository: input.repository, ref: input.ref ?? null, subdirectory: input.subdirectory, triggeredBy: req.user!.uid, targetName: target.name, clientName });
        await appendAuditEntry(scoped, { tenantId, action: 'scan.queued', actor: req.user!.uid, payload: { scanId: submitted.scanId, passportId: target.id, clientId, source: 'github', owner: input.owner, repository: input.repository, ref: input.ref ?? null } });
        return res.status(202).json({ scanId: submitted.scanId, passportId: target.id, clientId, status: 'Queued', jobs: { repository: submitted.repositoryJobId, security: submitted.securityJobId }, location: `/scans?run=${encodeURIComponent(submitted.scanId)}` });
      }
      // Upload: the intake session must be claimed by this tenant and hold at
      // least one uploaded item. Items are consumed by the intake scanner.
      const session = rows(await ownerDb.execute(sql`SELECT id, tenant_id AS "tenantId", status FROM intake_sessions WHERE id=${input.sessionId} LIMIT 1`))[0];
      if (!session || session.tenantId !== tenantId) return res.status(404).json({ error: 'INTAKE_SESSION_NOT_FOUND' });
      const items = rows(await ownerDb.execute(sql`SELECT id, name, status FROM intake_items WHERE session_id=${session.id} AND tenant_id=${tenantId} AND status IN ('UPLOADED','QUEUED') ORDER BY created_at ASC`));
      if (items.length === 0) return res.status(409).json({ error: 'INTAKE_SESSION_HAS_NO_UPLOADED_ITEMS' });
      const name = input.name ?? (items.length === 1 ? String(items[0].name) : `Upload ${new Date().toISOString().slice(0, 10)} (${items.length} files)`);
      if (!passport) {
        const passportId = id('passport');
        await scoped.execute(sql`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES (${passportId},${tenantId},${clientId},${name},'pending','Uploaded','Upload','unverified',${new Date().toISOString().slice(0, 10)},'pending','Unknown','Scan queued; no evidence has been observed yet.','[]','[]','[]','[]')`);
        passport = { id: passportId, name, client_id: clientId };
      }
      const submitted = await enqueueUploadScan(scoped, { tenantId, clientId, passportId: passport.id, sessionId: session.id, itemCount: items.length, triggeredBy: req.user!.uid, targetName: passport.name, clientName });
      await ownerDb.execute(sql`UPDATE intake_items SET status='QUEUED' WHERE session_id=${session.id} AND tenant_id=${tenantId} AND status='UPLOADED'`);
      await ownerDb.execute(sql`UPDATE intake_sessions SET status='CLAIMED' WHERE id=${session.id} AND tenant_id=${tenantId}`);
      await appendAuditEntry(scoped, { tenantId, action: 'scan.queued', actor: req.user!.uid, payload: { scanId: submitted.scanId, passportId: passport.id, clientId, source: 'upload', sessionId: session.id, itemCount: items.length } });
      return res.status(202).json({ scanId: submitted.scanId, passportId: passport.id, clientId, status: 'Queued', jobs: { intake: submitted.intakeJobId }, location: `/scans?run=${encodeURIComponent(submitted.scanId)}` });
    } catch (error) { return next(error); }
  });

  const listRuns = async (req: AuthenticatedRequest, res: any, next: any, forcedPassportId?: string) => {
    try {
      const parsed = listSchema.safeParse({ ...req.query, ...(forcedPassportId ? { passportId: forcedPassportId } : {}) });
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const { passportId, clientId, status, sourceKind, q } = parsed.data;
      const clientScope = req.user!.role === 'Client' ? req.user!.clientId ?? '' : null;
      const offset = (parsed.data.page - 1) * parsed.data.limit;
      const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
      const where = sql`r.tenant_id = ${req.user!.tenantId} AND r.passport_id IS NOT NULL
        AND (${clientScope}::text IS NULL OR COALESCE(r.client_id, p.client_id) = ${clientScope})
        AND (${passportId ?? null}::text IS NULL OR r.passport_id = ${passportId ?? null})
        AND (${clientId ?? null}::text IS NULL OR COALESCE(r.client_id, p.client_id) = ${clientId ?? null})
        AND (${status ?? null}::text IS NULL OR r.status = ${status ?? null})
        AND (${sourceKind ?? null}::text IS NULL OR r.source = ${sourceKind ?? null})
        AND (${like}::text IS NULL OR r.source_ref ILIKE ${like} OR p.name ILIKE ${like} OR r.id ILIKE ${like})`;
      const total = Number(rows(await req.db!.execute(sql`SELECT COUNT(*)::int AS count FROM scans r LEFT JOIN passports p ON p.id = r.passport_id AND p.tenant_id = r.tenant_id WHERE ${where}`))[0]?.count ?? 0);
      const items = rows(await req.db!.execute(sql`
        SELECT r.id, r.client_id AS "clientId", r.passport_id AS "passportId", r.source AS "sourceKind", r.source_ref AS "sourceRef", r.resolved_commit_sha AS "resolvedCommitSha", r.status, r.error_code AS "failureCode", r.error_state AS "errorState", r.coverage_state AS "coverageState", r.target_name AS "targetName", r.scan_type AS "scanType",
               r.passport_status AS "passportStatus", r.triggered_by AS "triggeredBy", r.created_at AS "createdAt", r.started_at AS "startedAt", r.completed_at AS "completedAt",
               p.name AS "passportName", p.verification_status AS "passportVerificationStatus", c.name AS "clientName",
               cov.files_discovered AS "filesDiscovered", cov.files_inspected AS "filesInspected", cov.files_analyzed AS "filesAnalyzed", cov.files_unsupported AS "filesUnsupported", cov.files_skipped AS "filesSkipped", cov.files_failed AS "filesFailed", cov.files_inaccessible AS "filesInaccessible", cov.files_unknown AS "filesUnknown",
               cov.accounting_coverage_pct AS "accountingCoveragePct", cov.inspection_coverage_pct AS "inspectionCoveragePct", cov.analysis_coverage_pct AS "analysisCoveragePct", cov.evidence_coverage_pct AS "evidenceCoveragePct",
               (SELECT COUNT(*)::int FROM scan_findings f WHERE f.scan_id = r.id AND f.tenant_id = r.tenant_id) AS "findingsCount",
               (SELECT COUNT(*)::int FROM evidence_items e WHERE e.scan_id = r.id AND e.tenant_id = r.tenant_id) AS "evidenceCount"
        FROM scans r
        LEFT JOIN passports p ON p.id = r.passport_id AND p.tenant_id = r.tenant_id
        LEFT JOIN clients c ON c.id = COALESCE(r.client_id, p.client_id) AND c.tenant_id = r.tenant_id
        LEFT JOIN scan_coverage cov ON cov.scan_id = r.id AND cov.tenant_id = r.tenant_id
        WHERE ${where}
        ORDER BY r.created_at DESC LIMIT ${parsed.data.limit} OFFSET ${offset}`));
      return res.json({ items, page: parsed.data.page, limit: parsed.data.limit, total });
    } catch (error) { return next(error); }
  };

  router.get('/scans/runs', (req: AuthenticatedRequest, res, next) => listRuns(req, res, next));
  router.get('/passports/:passportId/scan-history', (req: AuthenticatedRequest, res, next) => listRuns(req, res, next, String(req.params.passportId)));

  router.get('/scans/runs/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const run = await loadRun(req, String(req.params.id));
      if (!run) return res.status(404).json({ error: 'SCAN_RUN_NOT_FOUND' });
      const jobs = rows(await req.db!.execute(sql`SELECT id, agent_id AS "agentId", job_type AS "jobType", status, progress, error, attempt_count AS "attemptCount", max_attempts AS "maxAttempts", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", locked_at AS "lockedAt" FROM agent_jobs WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} ORDER BY created_at ASC`));
      const coverage = rows(await req.db!.execute(sql`SELECT files_discovered AS "filesDiscovered", files_accounted_for AS "filesAccountedFor", files_inspected AS "filesInspected", files_partially_inspected AS "filesPartiallyInspected", files_analyzed AS "filesAnalyzed", files_unsupported AS "filesUnsupported", files_skipped AS "filesSkipped", files_failed AS "filesFailed", files_inaccessible AS "filesInaccessible", files_unknown AS "filesUnknown", files_with_findings AS "filesWithFindings", files_without_findings AS "filesWithoutFindings", files_with_evidence AS "filesWithEvidence", archives_discovered AS "archivesDiscovered", archives_enumerated AS "archivesEnumerated", archives_unreadable AS "archivesUnreadable", inspection_applicable AS "inspectionApplicable", analysis_applicable AS "analysisApplicable", accounting_coverage_pct AS "accountingCoveragePct", inspection_coverage_pct AS "inspectionCoveragePct", analysis_coverage_pct AS "analysisCoveragePct", evidence_coverage_pct AS "evidenceCoveragePct", inventory_complete = 1 AS "inventoryComplete", limitations, computed_at AS "computedAt" FROM scan_coverage WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} LIMIT 1`))[0] ?? null;
      const dispositionBreakdown = rows(await req.db!.execute(sql`SELECT disposition, COUNT(*)::int AS count FROM scan_file_inventory WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} GROUP BY disposition ORDER BY count DESC`));
      const categoryBreakdown = rows(await req.db!.execute(sql`SELECT category, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE inspection_status='inspected')::int AS inspected, COUNT(*) FILTER (WHERE analysis_status='analyzed')::int AS analyzed FROM scan_file_inventory WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} GROUP BY category ORDER BY count DESC`));
      const reasonBreakdown = rows(await req.db!.execute(sql`SELECT disposition, reason_code AS "reasonCode", COUNT(*)::int AS count FROM scan_file_inventory WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} AND reason_code IS NOT NULL AND disposition IN ('unsupported','skipped','failed','inaccessible','unknown','inventoried','partially_inspected') GROUP BY disposition, reason_code ORDER BY count DESC LIMIT 100`));
      const findingSummary = rows(await req.db!.execute(sql`SELECT LOWER(severity) AS severity, COUNT(*)::int AS count FROM scan_findings WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} GROUP BY LOWER(severity)`));
      const evidenceSummary = rows(await req.db!.execute(sql`SELECT type, engine_id AS "engineId", COUNT(*)::int AS count FROM evidence_items WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId} GROUP BY type, engine_id ORDER BY count DESC`));
      const logs = rows(await req.db!.execute(sql`SELECT l.job_id AS "jobId", l.agent_id AS "agentId", l.message, l.level, l.timestamp FROM agent_logs l JOIN agent_jobs j ON j.id = l.job_id AND j.tenant_id=${req.user!.tenantId} WHERE j.scan_id=${run.id} ORDER BY l.timestamp DESC, l.id DESC LIMIT 50`));
      const previous = rows(await req.db!.execute(sql`SELECT id, created_at AS "createdAt", status FROM scans WHERE tenant_id=${req.user!.tenantId} AND passport_id=${run.passportId} AND id <> ${run.id} AND created_at < (SELECT created_at FROM scans WHERE id = ${run.id}) AND status IN ('Completed','Partial') ORDER BY created_at DESC LIMIT 1`))[0] ?? null;
      return res.json({ run, jobs, coverage, coverageDefinitions: COVERAGE_DEFINITIONS, breakdown: { byDisposition: dispositionBreakdown, byCategory: categoryBreakdown, byReason: reasonBreakdown }, findings: { bySeverity: findingSummary, total: findingSummary.reduce((t: number, r: any) => t + Number(r.count), 0) }, evidence: { byTypeAndEngine: evidenceSummary, total: evidenceSummary.reduce((t: number, r: any) => t + Number(r.count), 0) }, logs, previousRun: previous });
    } catch (error) { return next(error); }
  });

  router.get('/scans/runs/:id/files', async (req: AuthenticatedRequest, res, next) => {
    try {
      const run = await loadRun(req, String(req.params.id));
      if (!run) return res.status(404).json({ error: 'SCAN_RUN_NOT_FOUND' });
      const parsed = filesSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const f = parsed.data;
      const dispositions = csv(f.disposition); const categories = csv(f.category);
      const like = f.q ? `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
      const offset = (f.page - 1) * f.limit;
      const where = sql`i.scan_id = ${run.id} AND i.tenant_id = ${req.user!.tenantId}
        AND (${dispositions.length === 0} OR i.disposition = ANY(${dispositions}::text[]))
        AND (${categories.length === 0} OR i.category = ANY(${categories}::text[]))
        AND (${f.inspection ?? null}::text IS NULL OR i.inspection_status = ${f.inspection ?? null})
        AND (${f.analysis ?? null}::text IS NULL OR i.analysis_status = ${f.analysis ?? null})
        AND (${f.withFindings ?? null}::text IS NULL OR (jsonb_array_length(i.related_finding_ids) > 0) = ${f.withFindings === 'true'})
        AND (${f.withEvidence ?? null}::text IS NULL OR (jsonb_array_length(i.related_evidence_ids) > 0) = ${f.withEvidence === 'true'})
        AND (${f.parent ?? null}::text IS NULL OR i.parent_file_id = ${f.parent ?? null})
        AND (${like}::text IS NULL OR i.path ILIKE ${like})`;
      const total = Number(rows(await req.db!.execute(sql`SELECT COUNT(*)::int AS count FROM scan_file_inventory i WHERE ${where}`))[0]?.count ?? 0);
      const items = rows(await req.db!.execute(sql`
        SELECT i.id, i.parent_file_id AS "parentFileId", i.depth, i.sequence, i.path, i.filename, i.extension, i.detected_type AS "detectedType", i.detection_method AS "detectionMethod", i.category, i.size, i.sha256, i.source,
               i.is_archive = 1 AS "isArchive", CASE WHEN i.archive_enumerated IS NULL THEN NULL ELSE i.archive_enumerated = 1 END AS "archiveEnumerated",
               i.discovered_at AS "discoveredAt", i.disposition, i.inspection_status AS "inspectionStatus", i.analysis_status AS "analysisStatus", i.inspection_level AS "inspectionLevel", i.tools, i.reason_code AS "reasonCode", i.reason_detail AS "reasonDetail", i.notes,
               i.related_components AS "relatedComponents", i.related_finding_ids AS "relatedFindingIds", i.related_evidence_ids AS "relatedEvidenceIds", i.updated_at AS "updatedAt"
        FROM scan_file_inventory i WHERE ${where} ORDER BY i.sequence ASC LIMIT ${f.limit} OFFSET ${offset}`));
      return res.json({ items, page: f.page, limit: f.limit, total, scanId: run.id });
    } catch (error) { return next(error); }
  });

  router.get('/scans/runs/:id/findings', async (req: AuthenticatedRequest, res, next) => {
    try {
      const run = await loadRun(req, String(req.params.id));
      if (!run) return res.status(404).json({ error: 'SCAN_RUN_NOT_FOUND' });
      const parsed = findingsSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const f = parsed.data; const severities = csv(f.severity).map((s) => s.toLowerCase());
      const offset = (f.page - 1) * f.limit;
      const where = sql`f.scan_id = ${run.id} AND f.tenant_id = ${req.user!.tenantId}
        AND (${severities.length === 0} OR LOWER(f.severity) = ANY(${severities}::text[]))
        AND (${f.status ?? null}::text IS NULL OR LOWER(f.status) = LOWER(${f.status ?? null}))
        AND (${f.category ?? null}::text IS NULL OR f.category = ${f.category ?? null})
        AND (${f.engine ?? null}::text IS NULL OR f.engine_id = ${f.engine ?? null})
        AND (${f.filePath ?? null}::text IS NULL OR f.file_path = ${f.filePath ?? null})`;
      const total = Number(rows(await req.db!.execute(sql`SELECT COUNT(*)::int AS count FROM scan_findings f WHERE ${where}`))[0]?.count ?? 0);
      const items = rows(await req.db!.execute(sql`
        SELECT f.id, f.severity, f.category, f.title, f.description, f.component, f.fixed_version AS "fixedVersion", f.status, f.detected_at AS "detectedAt", f.engine_id AS "engineId", f.file_path AS "filePath", f.job_id AS "jobId", f.vex_status AS "vexStatus", f.reachability, f.state, f.updated_at AS "updatedAt",
               (SELECT i.id FROM scan_file_inventory i WHERE i.scan_id = f.scan_id AND i.tenant_id = f.tenant_id AND i.path = f.file_path ORDER BY i.sequence LIMIT 1) AS "fileId"
        FROM scan_findings f WHERE ${where}
        ORDER BY CASE LOWER(f.severity) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.detected_at DESC LIMIT ${f.limit} OFFSET ${offset}`));
      // Lineage for each finding: FILE -> SCAN -> SOFTWARE -> CLIENT -> TENANT, all from persisted rows.
      return res.json({ items, page: f.page, limit: f.limit, total, lineage: { scanId: run.id, passportId: run.passportId, clientId: run.clientId ?? run.passportClientId ?? null, tenantId: run.tenantId } });
    } catch (error) { return next(error); }
  });

  router.get('/scans/runs/:id/evidence', async (req: AuthenticatedRequest, res, next) => {
    try {
      const run = await loadRun(req, String(req.params.id));
      if (!run) return res.status(404).json({ error: 'SCAN_RUN_NOT_FOUND' });
      const parsed = pagedSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const offset = (parsed.data.page - 1) * parsed.data.limit;
      const total = Number(rows(await req.db!.execute(sql`SELECT COUNT(*)::int AS count FROM evidence_items WHERE scan_id=${run.id} AND tenant_id=${req.user!.tenantId}`))[0]?.count ?? 0);
      // raw_content is the provider payload (OSV responses, descriptors); its
      // length and hash are returned, the payload itself is not, so a list of
      // thousands of evidence rows stays small and no SBOM contents leave here.
      const items = rows(await req.db!.execute(sql`
        SELECT e.id, e.name, e.type, e.verified = 1 AS verified, e.status, e.signer, e.timestamp, e.hash, e.engine_id AS "engineId", e.verification_failure_reason AS "verificationFailureReason", length(e.raw_content) AS "rawContentBytes",
               (SELECT COUNT(*)::int FROM scan_file_inventory i WHERE i.scan_id = e.scan_id AND i.tenant_id = e.tenant_id AND i.related_evidence_ids ? e.id) AS "relatedFileCount"
        FROM evidence_items e WHERE e.scan_id=${run.id} AND e.tenant_id=${req.user!.tenantId} ORDER BY e.timestamp DESC, e.id LIMIT ${parsed.data.limit} OFFSET ${offset}`));
      return res.json({ items, page: parsed.data.page, limit: parsed.data.limit, total, lineage: { scanId: run.id, passportId: run.passportId, clientId: run.clientId ?? run.passportClientId ?? null, tenantId: run.tenantId } });
    } catch (error) { return next(error); }
  });

  /**
   * Compares this run with the previous settled run of the same passport,
   * from persisted rows only: files by path+hash, dependencies by the
   * normalized component set the repository job stored, findings by identity.
   * Nothing is reported as changed unless both sides were actually observed.
   */
  router.get('/scans/runs/:id/changes', async (req: AuthenticatedRequest, res, next) => {
    try {
      const run = await loadRun(req, String(req.params.id));
      if (!run) return res.status(404).json({ error: 'SCAN_RUN_NOT_FOUND' });
      const previous = rows(await req.db!.execute(sql`SELECT id, created_at AS "createdAt", status, resolved_commit_sha AS "resolvedCommitSha", source_ref AS "sourceRef" FROM scans WHERE tenant_id=${req.user!.tenantId} AND passport_id=${run.passportId} AND id <> ${run.id} AND created_at < (SELECT created_at FROM scans WHERE id = ${run.id}) AND status IN ('Completed','Partial') ORDER BY created_at DESC LIMIT 1`))[0] ?? null;
      if (!previous) return res.json({ scanId: run.id, previousRunId: null, comparable: false, reason: 'NO_PREVIOUS_SETTLED_SCAN', files: null, dependencies: null, findings: null, coverage: null });
      const tenantId = req.user!.tenantId;
      const fileDiff = rows(await req.db!.execute(sql`
        WITH cur AS (SELECT path, sha256, disposition FROM scan_file_inventory WHERE scan_id=${run.id} AND tenant_id=${tenantId} AND source <> 'nested-archive'),
             prev AS (SELECT path, sha256, disposition FROM scan_file_inventory WHERE scan_id=${previous.id} AND tenant_id=${tenantId} AND source <> 'nested-archive')
        SELECT
          (SELECT COUNT(DISTINCT path)::int FROM cur WHERE path NOT IN (SELECT path FROM prev)) AS added,
          (SELECT COUNT(DISTINCT path)::int FROM prev WHERE path NOT IN (SELECT path FROM cur)) AS removed,
          (SELECT COUNT(DISTINCT c.path)::int FROM cur c JOIN prev p ON p.path = c.path WHERE c.sha256 IS NOT NULL AND p.sha256 IS NOT NULL AND c.sha256 <> p.sha256) AS modified,
          (SELECT COUNT(DISTINCT c.path)::int FROM cur c JOIN prev p ON p.path = c.path WHERE c.sha256 IS NULL OR p.sha256 IS NULL) AS "hashUnavailable",
          (SELECT COUNT(DISTINCT c.path)::int FROM cur c JOIN prev p ON p.path = c.path WHERE c.sha256 IS NOT NULL AND c.sha256 = p.sha256) AS unchanged`))[0];
      const addedFiles = rows(await req.db!.execute(sql`SELECT DISTINCT path FROM scan_file_inventory WHERE scan_id=${run.id} AND tenant_id=${tenantId} AND source <> 'nested-archive' AND path NOT IN (SELECT path FROM scan_file_inventory WHERE scan_id=${previous.id} AND tenant_id=${tenantId}) ORDER BY path LIMIT 200`)).map((r: any) => r.path);
      const removedFiles = rows(await req.db!.execute(sql`SELECT DISTINCT path FROM scan_file_inventory WHERE scan_id=${previous.id} AND tenant_id=${tenantId} AND source <> 'nested-archive' AND path NOT IN (SELECT path FROM scan_file_inventory WHERE scan_id=${run.id} AND tenant_id=${tenantId}) ORDER BY path LIMIT 200`)).map((r: any) => r.path);
      const modifiedFiles = rows(await req.db!.execute(sql`SELECT DISTINCT c.path FROM scan_file_inventory c JOIN scan_file_inventory p ON p.path = c.path AND p.scan_id=${previous.id} AND p.tenant_id=${tenantId} WHERE c.scan_id=${run.id} AND c.tenant_id=${tenantId} AND c.sha256 IS NOT NULL AND p.sha256 IS NOT NULL AND c.sha256 <> p.sha256 ORDER BY c.path LIMIT 200`)).map((r: any) => r.path);
      // Dependencies: the normalized component lists persisted by each run's repository job.
      const componentsFor = async (runId: string): Promise<Set<string> | null> => {
        const row = rows(await req.db!.execute(sql`SELECT s.normalized_components AS components FROM repository_scan_sources s JOIN agent_jobs j ON j.id = s.job_id AND j.tenant_id = s.tenant_id WHERE j.scan_id=${runId} AND j.tenant_id=${tenantId} AND j.job_type='repository_scan' AND s.normalized_components_hash IS NOT NULL LIMIT 1`))[0];
        if (!row) return null;
        try { const parsed = JSON.parse(row.components); return new Set((Array.isArray(parsed) ? parsed : []).map((c: any) => `${c.purl || c.name}@${c.version || ''}`)); } catch { return null; }
      };
      const [curComponents, prevComponents] = await Promise.all([componentsFor(run.id), componentsFor(previous.id)]);
      const dependencies = curComponents && prevComponents
        ? { comparable: true, added: [...curComponents].filter((c) => !prevComponents.has(c)).sort().slice(0, 500), removed: [...prevComponents].filter((c) => !curComponents.has(c)).sort().slice(0, 500), currentTotal: curComponents.size, previousTotal: prevComponents.size }
        : { comparable: false, reason: 'SBOM_NOT_PERSISTED_FOR_BOTH_SCANS' };
      const findingDiff = rows(await req.db!.execute(sql`
        WITH cur AS (SELECT id, severity, title, status FROM scan_findings WHERE scan_id=${run.id} AND tenant_id=${tenantId}),
             prev AS (SELECT id, severity, title, status FROM scan_findings WHERE scan_id=${previous.id} AND tenant_id=${tenantId})
        SELECT (SELECT COUNT(*)::int FROM cur WHERE id NOT IN (SELECT id FROM prev)) AS opened,
               (SELECT COUNT(*)::int FROM prev WHERE id NOT IN (SELECT id FROM cur)) AS "notObservedAgain",
               (SELECT COUNT(*)::int FROM cur c JOIN prev p ON p.id = c.id WHERE c.status <> p.status OR c.severity <> p.severity) AS changed,
               (SELECT COUNT(*)::int FROM cur c JOIN prev p ON p.id = c.id) AS carried`))[0];
      const openedFindings = rows(await req.db!.execute(sql`SELECT id, severity, category, title, file_path AS "filePath", component FROM scan_findings WHERE scan_id=${run.id} AND tenant_id=${tenantId} AND id NOT IN (SELECT id FROM scan_findings WHERE scan_id=${previous.id} AND tenant_id=${tenantId}) ORDER BY detected_at DESC LIMIT 200`));
      const notObservedFindings = rows(await req.db!.execute(sql`SELECT id, severity, category, title, file_path AS "filePath", component, status FROM scan_findings WHERE scan_id=${previous.id} AND tenant_id=${tenantId} AND id NOT IN (SELECT id FROM scan_findings WHERE scan_id=${run.id} AND tenant_id=${tenantId}) ORDER BY detected_at DESC LIMIT 200`));
      const coverageRows = rows(await req.db!.execute(sql`SELECT scan_id AS "scanId", files_discovered AS "filesDiscovered", files_inspected AS "filesInspected", files_analyzed AS "filesAnalyzed", inspection_coverage_pct AS "inspectionCoveragePct", analysis_coverage_pct AS "analysisCoveragePct", evidence_coverage_pct AS "evidenceCoveragePct" FROM scan_coverage WHERE tenant_id=${tenantId} AND scan_id IN (${run.id}, ${previous.id})`));
      const evidenceCounts = rows(await req.db!.execute(sql`SELECT scan_id AS "scanId", COUNT(*)::int AS count FROM evidence_items WHERE tenant_id=${tenantId} AND scan_id IN (${run.id}, ${previous.id}) GROUP BY scan_id`));
      const cov = (idValue: string) => coverageRows.find((r: any) => r.scanId === idValue) ?? null;
      const ev = (idValue: string) => Number(evidenceCounts.find((r: any) => r.scanId === idValue)?.count ?? 0);
      return res.json({
        scanId: run.id, previousRunId: previous.id, comparable: true,
        previous: { id: previous.id, createdAt: previous.createdAt, status: previous.status, resolvedCommitSha: previous.resolvedCommitSha, sourceRef: previous.sourceRef },
        current: { id: run.id, createdAt: run.createdAt, status: run.status, resolvedCommitSha: run.resolvedCommitSha, sourceRef: run.sourceRef },
        files: { ...fileDiff, addedPaths: addedFiles, removedPaths: removedFiles, modifiedPaths: modifiedFiles, rule: 'A file is "modified" only when both scans hashed it and the hashes differ; files without a hash on either side are counted separately as hashUnavailable.' },
        dependencies,
        findings: { ...findingDiff, opened: openedFindings, notObservedAgain: notObservedFindings, rule: 'A finding not observed again is reported as such -- not as "resolved". Resolution is a workflow state recorded on the finding, never inferred from absence.' },
        coverage: { current: cov(run.id), previous: cov(previous.id) },
        evidence: { current: ev(run.id), previous: ev(previous.id) },
      });
    } catch (error) { return next(error); }
  });

  /**
   * Recovery for a scan whose evidence persisted but whose passport
   * association failed: re-applies the persisted SBOM/commit to the passport.
   * Nothing is regenerated and nothing is invented; if the source rows are not
   * there the route says so.
   */
  router.post('/scans/runs/:id/associate-passport', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const run = await loadRun(req, String(req.params.id));
      if (!run) return res.status(404).json({ error: 'SCAN_RUN_NOT_FOUND' });
      if (run.passportStatus === 'associated') return res.json({ scanId: run.id, passportId: run.passportId, passportStatus: 'associated', changed: false });
      const tenantId = req.user!.tenantId;
      const source = rows(await req.db!.execute(sql`SELECT s.repository_owner AS owner, s.repository_name AS repository, s.resolved_commit_sha AS "commitSha", s.source_descriptor_hash AS "sourceHash", s.normalized_components AS components, s.acquired_at AS "acquiredAt" FROM repository_scan_sources s JOIN agent_jobs j ON j.id = s.job_id AND j.tenant_id = s.tenant_id WHERE j.scan_id=${run.id} AND j.tenant_id=${tenantId} AND j.job_type='repository_scan' AND s.normalized_components_hash IS NOT NULL LIMIT 1`))[0];
      if (!source) return res.status(409).json({ error: 'NO_PERSISTED_SBOM_FOR_SCAN', message: 'The scan has no persisted SBOM to associate; re-run the scan.' });
      let components: unknown[] = [];
      try { components = JSON.parse(source.components); } catch { components = []; }
      const versioned = (Array.isArray(components) ? components : []).filter((c: any) => c && typeof c.version === 'string' && c.version);
      const releaseDate = source.acquiredAt ? new Date(source.acquiredAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      // req.db is already one transaction for the request (tenant-scope), so
      // both statements commit or roll back together.
      await req.db!.execute(sql`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,overall_score,security_score,compliance_score,vendor_reputation_score,verification_status,release_date,file_hash,license_type,ai_summary,sbom,evidence,vulnerabilities,timeline) VALUES (${run.passportId},${tenantId},${run.clientId ?? null},${source.repository},${source.commitSha},${source.owner},'Repository',NULL,NULL,NULL,NULL,'unverified',${releaseDate},${source.sourceHash},'Unknown','Repository acquired and SBOM generated. Trust assessment remains pending.',${JSON.stringify(versioned)},'[]','[]','[]') ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version,file_hash=EXCLUDED.file_hash,sbom=EXCLUDED.sbom,release_date=EXCLUDED.release_date,ai_summary=EXCLUDED.ai_summary,overall_score=NULL,security_score=NULL,compliance_score=NULL,vendor_reputation_score=NULL,verification_status='unverified' WHERE passports.tenant_id=${tenantId}`);
      await req.db!.execute(sql`UPDATE scans SET passport_status='associated', passport_failure=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=${run.id} AND tenant_id=${tenantId}`);
      await appendAuditEntry(req.db!, { tenantId, action: 'passport.published', actor: req.user!.uid, payload: { passportId: run.passportId, scanId: run.id, recovery: true, version: source.commitSha } });
      return res.json({ scanId: run.id, passportId: run.passportId, passportStatus: 'associated', changed: true });
    } catch (error) { return next(error); }
  });

  return router;
}
