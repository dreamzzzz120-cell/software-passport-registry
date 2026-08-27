import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/security.ts';
import { decryptCredentials } from '../integrations/credential-vault.ts';
import { collectDeepProviderEvidence } from '../integrations/deep-collectors.ts';
import { collectGitHubDeepEvidence } from '../integrations/github-deep.ts';
import { persistTrustLoop, verifyRemediation } from '../trust/trust-loop.ts';

const collectSchema = z.object({ passportId: z.string().trim().min(1).max(255), provider: z.string().trim().min(1).max(64) }).strict();
const remediationSchema = z.object({
  findingId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(4000).optional(),
  assigneeId: z.string().max(255).optional(),
  assigneeDisplay: z.string().max(255).optional(),
  externalSystem: z.string().trim().min(1).max(64).default('SPR'),
  externalTicketId: z.string().max(255).optional(),
  slaDueAt: z.string().datetime().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
}).strict();
const remediationUpdateSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_VERIFICATION', 'VERIFIED', 'CLOSED', 'CANCELLED']), ownerId: z.string().max(255).optional(), ownerDisplay: z.string().max(255).optional(), slaDueAt: z.string().datetime().nullable().optional() }).strict();
const verifySchema = z.object({ findingId: z.string().trim().min(1), observationIds: z.array(z.string().min(1)).max(50), evidenceIds: z.array(z.string().min(1)).max(200) }).strict();
const reportTypes = z.enum(['executive', 'technical', 'msp', 'customer', 'compliance', 'vendor', 'auditor', 'evidence-ledger']);
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function parseJson(value: unknown, fallback: unknown = []) { try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

export type ReportPassportRow = { overall_score: number | null; security_score: number | null; compliance_score: number | null; verification_status: string | null; confidence_score: number | null; evidence_completeness: number | null };
export type ReportRiskFields = { canonicalScore: number | null; verificationStatus: string; confidenceBasisPoints: number; completenessBasisPoints: number };

// A trust_report_snapshots row is a permanent historical record. It must
// never claim a measurement exists when the passport has none: this is the
// single place buildAndPersistReport derives score/confidence/completeness/
// status from the canonical passport row, so the same rule (null score
// stays null, never coalesced to 0) applies whether the report is built now
// or from any future call site.
export function deriveReportRiskFields(passport: ReportPassportRow): ReportRiskFields {
  return {
    canonicalScore: passport.overall_score == null ? null : Number(passport.overall_score),
    verificationStatus: passport.verification_status ?? 'unverified',
    confidenceBasisPoints: Math.round(Number(passport.confidence_score ?? 0) * 100),
    completenessBasisPoints: Math.round(Number(passport.evidence_completeness ?? 0) * 100),
  };
}

function buildReportTypeExtras(reportType: string, passport: any, findings: any[]) {
  if (reportType === 'sbom') {
    const components = parseJson(passport.sbom, []) as any[];
    const vulnerabilities = parseJson(passport.vulnerabilities, []) as any[];
    const sbom = components.map((component) => {
      const name = component?.name || component?.packageName || component?.component;
      const matched = vulnerabilities.filter((vuln) => (vuln?.component || vuln?.packageName || vuln?.package) === name);
      return { ...component, vulnerabilityCount: matched.length, criticalOrHighCount: matched.filter((vuln) => SEVERITY_ORDER.slice(0, 2).includes(String(vuln?.severity || '').toLowerCase())).length };
    });
    return { sbom };
  }
  if (reportType === 'compliance') {
    const byControl = new Map<string, { controlId: string; findingCount: number; openCount: number; worstSeverity: string; findingIds: string[] }>();
    for (const finding of findings) {
      const controlId = finding.control_id || 'unmapped';
      const entry = byControl.get(controlId) || { controlId, findingCount: 0, openCount: 0, worstSeverity: 'low', findingIds: [] as string[] };
      entry.findingCount += 1;
      entry.findingIds.push(finding.id);
      if (!['resolved', 'closed', 'verified'].includes(String(finding.status || '').toLowerCase())) entry.openCount += 1;
      const severity = String(finding.severity || '').toLowerCase();
      if (SEVERITY_ORDER.includes(severity) && SEVERITY_ORDER.indexOf(severity) < SEVERITY_ORDER.indexOf(entry.worstSeverity)) entry.worstSeverity = severity;
      byControl.set(controlId, entry);
    }
    return { controls: [...byControl.values()] };
  }
  return {};
}

export function createTrustLoopRouter() {
  const router = Router();

  router.post('/collect', async (req: AuthenticatedRequest, res, next) => {
    const parsed = collectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    const { passportId, provider } = parsed.data;
    const tenantId = req.user!.tenantId;
    const runId = id('collect');
    const startedAt = new Date().toISOString();
    const db = req.db!;
    try {
      const passport = (await db.execute(sql`SELECT id,client_id FROM passports WHERE id=${passportId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
      const stored = (await db.execute(sql`SELECT encrypted_payload FROM integration_credentials WHERE tenant_id=${tenantId} AND provider=${provider} LIMIT 1`) as any).rows?.[0];
      if (!stored?.encrypted_payload) return res.status(409).json({ error: 'CREDENTIAL_NOT_CONFIGURED' });

      await db.execute(sql`INSERT INTO trust_collection_runs (id,tenant_id,passport_id,provider,started_at,status,idempotency_key,created_at) VALUES (${runId},${tenantId},${passportId},${provider},${startedAt},'RUNNING',${`${tenantId}:${passportId}:${provider}:${startedAt}`},${startedAt})`);
      const credentials = decryptCredentials(stored.encrypted_payload) as Record<string, string>;
      const observations = provider === 'github' ? await collectGitHubDeepEvidence(credentials) : await collectDeepProviderEvidence(provider as any, credentials);
      const result = await persistTrustLoop({ tenantId, passportId, clientId: passport.client_id || passport.id, assetId: passport.id, observations, generationReason: 'provider_collection', actorType: 'worker', collectorVersionMap: { [provider]: 'deep-v2' } });
      const completedAt = new Date().toISOString();
      await db.execute(sql`UPDATE trust_collection_runs SET completed_at=${completedAt},status='SUCCEEDED',observation_count=${observations.length},evidence_count=${result.evidenceIds.length},failure_count=${observations.filter((o) => o.status === 'FAIL').length},collector_version='deep-v2' WHERE id=${runId} AND tenant_id=${tenantId}`);
      await db.execute(sql`INSERT INTO trust_monitoring_state (id,tenant_id,passport_id,provider,next_run_at,last_run_at,last_success_at,last_evidence_hash,consecutive_failures,status,updated_at) VALUES (${id('monitor')},${tenantId},${passportId},${provider},${new Date(Date.now()+3600000).toISOString()},${completedAt},${completedAt},${result.payloadHash},0,'HEALTHY',${completedAt}) ON CONFLICT (tenant_id,passport_id,provider) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,last_run_at=EXCLUDED.last_run_at,last_success_at=EXCLUDED.last_success_at,last_evidence_hash=EXCLUDED.last_evidence_hash,consecutive_failures=0,status='HEALTHY',updated_at=EXCLUDED.updated_at`);
      return res.json({ runId, provider, observationCount: observations.length, ...result });
    } catch (error) {
      const completedAt = new Date().toISOString();
      await db.execute(sql`UPDATE trust_collection_runs SET completed_at=${completedAt},status='FAILED',error_code='COLLECTION_FAILED',error_message=${error instanceof Error ? error.message.slice(0,1000) : 'COLLECTION_FAILED'} WHERE id=${runId} AND tenant_id=${tenantId}`).catch(() => undefined);
      await db.execute(sql`UPDATE trust_monitoring_state SET last_run_at=${completedAt},last_failure_at=${completedAt},consecutive_failures=consecutive_failures+1,status=CASE WHEN consecutive_failures+1 >= 5 THEN 'FAILED' ELSE 'DEGRADED' END,updated_at=${completedAt} WHERE tenant_id=${tenantId} AND passport_id=${passportId} AND provider=${provider}`).catch(() => undefined);
      return next(error);
    }
  });

  // Every finding's workflow state actually lives on its most recent remediation
  // work item, not on the finding row itself — without this join the frontend has
  // no way to know a remediation already exists, so "resolve"/"assign" actions on
  // an alert would PATCH a work item id that was never created and silently no-op.
  const findingsWithRemediationSelect = sql`
    SELECT f.*, r.id AS remediation_id, r.status AS remediation_status, r.owner_id AS remediation_owner_id,
           r.owner_display AS remediation_owner_display, r.sla_due_at AS remediation_sla_due_at, r.updated_at AS remediation_updated_at
    FROM trust_findings f
    LEFT JOIN LATERAL (
      SELECT * FROM trust_remediation_work_items w
      WHERE w.tenant_id = f.tenant_id AND w.finding_id = f.id
      ORDER BY w.created_at DESC LIMIT 1
    ) r ON true
  `;
  router.get('/findings', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passportId = typeof req.query.passportId === 'string' ? req.query.passportId : null;
      const rows = passportId
        ? await db.execute(sql`${findingsWithRemediationSelect} WHERE f.tenant_id=${tenantId} AND f.passport_id=${passportId} ORDER BY CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,f.updated_at DESC`)
        : await db.execute(sql`${findingsWithRemediationSelect} WHERE f.tenant_id=${tenantId} ORDER BY f.updated_at DESC`);
      return res.json({ findings: (rows as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.post('/remediations', async (req: AuthenticatedRequest, res, next) => {
    const parsed = remediationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const p = parsed.data;
      const tenantId = req.user!.tenantId;
      const finding = (await db.execute(sql`SELECT id,client_id,passport_id,title,description FROM trust_findings WHERE id=${p.findingId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!finding) return res.status(404).json({ error: 'FINDING_NOT_FOUND' });
      const now = new Date().toISOString();
      const workId = id('remed');
      await db.execute(sql`INSERT INTO trust_remediation_work_items (id,tenant_id,passport_id,finding_id,external_system,external_ticket_id,owner_id,owner_display,sla_due_at,status,remediation_plan,created_at,updated_at) VALUES (${workId},${tenantId},${finding.passport_id},${finding.id},${p.externalSystem},${p.externalTicketId ?? null},${p.assigneeId ?? null},${p.assigneeDisplay ?? null},${p.slaDueAt ?? null},'OPEN',${p.description || finding.description},${now},${now})`);
      await db.execute(sql`INSERT INTO remediation_tasks (id,tenant_id,client_id,alert_id,title,description,priority,status,assignee_id,created_by,created_at,updated_at) VALUES (${workId},${tenantId},${finding.client_id},${finding.id},${p.title},${p.description || finding.description},${p.priority},'OPEN',${p.assigneeId ?? null},${req.user!.uid},${now},${now})`);
      return res.status(201).json({ id: workId, findingId: finding.id, status: 'OPEN', slaDueAt: p.slaDueAt ?? null });
    } catch (error) { return next(error); }
  });

  router.patch('/remediations/:id', async (req: AuthenticatedRequest, res, next) => {
    const parsed = remediationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const p = parsed.data;
      const now = new Date().toISOString();
      const rows = await db.execute(sql`UPDATE trust_remediation_work_items SET status=${p.status},owner_id=COALESCE(${p.ownerId ?? null},owner_id),owner_display=COALESCE(${p.ownerDisplay ?? null},owner_display),sla_due_at=CASE WHEN ${p.slaDueAt === undefined} THEN sla_due_at ELSE ${p.slaDueAt} END,updated_at=${now},closed_at=CASE WHEN ${p.status} IN ('CLOSED','VERIFIED') THEN ${now} ELSE closed_at END WHERE id=${req.params.id} AND tenant_id=${tenantId} RETURNING *`);
      const row = (rows as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'REMEDIATION_NOT_FOUND' });
      return res.json(row);
    } catch (error) { return next(error); }
  });

  router.post('/verify', async (req: AuthenticatedRequest, res, next) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const result = await verifyRemediation({ ...parsed.data, tenantId: req.user!.tenantId, actorId: req.user!.uid });
      await db.execute(sql`UPDATE trust_remediation_work_items SET status='VERIFIED',updated_at=${new Date().toISOString()},closed_at=${new Date().toISOString()} WHERE tenant_id=${req.user!.tenantId} AND finding_id=${parsed.data.findingId}`);
      return res.json(result);
    } catch (error) { return next(error); }
  });

  router.get('/monitoring', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passportId = typeof req.query.passportId === 'string' ? req.query.passportId : null;
      const rows = passportId ? await db.execute(sql`SELECT * FROM trust_monitoring_state WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY provider`) : await db.execute(sql`SELECT * FROM trust_monitoring_state WHERE tenant_id=${tenantId} ORDER BY passport_id,provider`);
      const alerts = passportId ? await db.execute(sql`SELECT * FROM trust_alerts WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY created_at DESC`) : await db.execute(sql`SELECT * FROM trust_alerts WHERE tenant_id=${tenantId} ORDER BY created_at DESC`);
      return res.json({ monitoring: (rows as any).rows || [], alerts: (alerts as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.get('/ledger/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passportId = req.params.passportId;
      const scope = await db.execute(sql`SELECT id FROM passports WHERE id=${passportId} AND tenant_id=${tenantId} LIMIT 1`);
      if (!(scope as any).rows?.length) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
      const observations = await db.execute(sql`SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY observation_version DESC`);
      const evidence = await db.execute(sql`SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY observed_at DESC`);
      const findings = await db.execute(sql`SELECT id,control_id,title,severity,status,evidence_ids,fingerprint,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY updated_at DESC`);
      const remediation = await db.execute(sql`SELECT * FROM trust_remediation_work_items WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY updated_at DESC`);
      const verification = await db.execute(sql`SELECT * FROM remediation_verification_ledger WHERE tenant_id=${tenantId} AND finding_id IN (SELECT id FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passportId}) ORDER BY created_at DESC`);
      return res.json({ observations: (observations as any).rows || [], findings: (findings as any).rows || [], evidence: (evidence as any).rows || [], remediation: (remediation as any).rows || [], verification: (verification as any).rows || [], trace: 'Report -> Passport -> Risk -> Finding -> Observation -> Provider -> Source -> Timestamp -> Hash' });
    } catch (error) { return next(error); }
  });

  router.get('/reports/:passportId/history', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passportId = req.params.passportId;
      const typeFilter = typeof req.query.type === 'string' ? reportTypes.safeParse(req.query.type) : null;
      if (typeFilter && !typeFilter.success) return res.status(400).json({ error: 'INVALID_REPORT_TYPE' });
      const rows = typeFilter?.success
        ? await db.execute(sql`SELECT id,report_type,generated_at,score,verification_status,confidence_basis_points,completeness_basis_points,canonical_payload_hash FROM trust_report_snapshots WHERE tenant_id=${tenantId} AND passport_id=${passportId} AND report_type=${typeFilter.data} ORDER BY generated_at DESC LIMIT 50`)
        : await db.execute(sql`SELECT id,report_type,generated_at,score,verification_status,confidence_basis_points,completeness_basis_points,canonical_payload_hash FROM trust_report_snapshots WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY generated_at DESC LIMIT 50`);
      return res.json({ snapshots: (rows as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.get('/reports/:passportId/history/:snapshotId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const row = (await db.execute(sql`SELECT payload,canonical_payload_hash,generated_at,report_type FROM trust_report_snapshots WHERE id=${req.params.snapshotId} AND tenant_id=${tenantId} AND passport_id=${req.params.passportId} LIMIT 1`) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'REPORT_SNAPSHOT_NOT_FOUND' });
      const payload = parseJson(row.payload, {});
      return res.json({ ...(payload as object), reportHash: row.canonical_payload_hash });
    } catch (error) { return next(error); }
  });

  router.get('/reports/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = reportTypes.safeParse(req.query.type || 'executive');
      if (!parsed.success) return res.status(400).json({ error: 'INVALID_REPORT_TYPE' });
      const report = await buildAndPersistReport(req.db!, req.user!.tenantId, String(req.params.passportId), parsed.data);
      if (!report) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
      return res.json(report);
    } catch (error) { return next(error); }
  });

  return router;
}

// Shared by GET /reports/:passportId above and by other routers (e.g. the
// compliance-schedule "run" action) that need to generate the same
// evidence-backed report rather than building a second generator. Returns
// null if the passport doesn't exist for this tenant; the caller decides
// how to surface that (404 vs. skip-and-continue for a multi-passport run).
export async function buildAndPersistReport(db: any, tenantId: string, passportId: string, reportType: string) {
  const passport = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,verification_status,confidence_score,evidence_completeness,sbom,evidence,vulnerabilities,timeline FROM passports WHERE id=${passportId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
  if (!passport) return null;
  const findings = (await db.execute(sql`SELECT id,control_id,title,severity,status,description,remediation,evidence_ids,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,updated_at DESC`) as any).rows || [];
  const evidence = (await db.execute(sql`SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY observed_at DESC`) as any).rows || [];
  const observations = (await db.execute(sql`SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY observation_version DESC`) as any).rows || [];
  const remediation = (await db.execute(sql`SELECT * FROM trust_remediation_work_items WHERE tenant_id=${tenantId} AND passport_id=${passportId} ORDER BY updated_at DESC`) as any).rows || [];
  const verification = (await db.execute(sql`SELECT * FROM remediation_verification_ledger WHERE tenant_id=${tenantId} AND finding_id IN (SELECT id FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passportId}) ORDER BY created_at DESC`) as any).rows || [];
  const latest = observations[0];
  // Score/confidence/completeness/status all come from the passport row --
  // i.e. from calculateCanonicalScores (src/trust/scoring-engine.ts), the
  // single authoritative scoring engine. This report never calculates its
  // own score, and never coalesces an unverified passport's null score into
  // a fabricated 0: a report is a permanent historical record, and it must
  // not claim a measurement was made when it wasn't.
  const { canonicalScore, verificationStatus, confidenceBasisPoints, completenessBasisPoints } = deriveReportRiskFields(passport);
  const report = {
    schemaVersion: 'spr.report.v2', reportType, generatedAt: new Date().toISOString(), passport: { id: passport.id, name: passport.name },
    risk: { overall: canonicalScore, security: passport.security_score, compliance: passport.compliance_score, verificationStatus },
    evidenceQuality: { completenessBasisPoints, unknownDimensions: latest?.unknown_dimension_count ?? 0, latestObservationAt: latest?.generated_at ?? null },
    findings, evidence, observations, remediation, verification,
    traceability: 'Report -> Passport -> Risk -> Finding -> Observation -> Provider -> Source -> Timestamp -> Hash',
    resolutionTraceability: 'Finding -> remediation -> new observation -> independent verification',
    limitations: evidence.filter((item: any) => item.limitation).map((item: any) => ({ evidenceId: item.id, limitation: item.limitation })),
    ...buildReportTypeExtras(reportType, passport, findings),
  };
  const canonicalPayload = JSON.stringify(report);
  const reportHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  await db.execute(sql`INSERT INTO trust_report_snapshots (id,tenant_id,passport_id,report_type,generated_at,score,verification_status,confidence_basis_points,completeness_basis_points,evidence_ids,finding_ids,observation_id,canonical_payload_hash,payload,created_at) VALUES (${id('report')},${tenantId},${passportId},${reportType},${report.generatedAt},${canonicalScore},${verificationStatus},${confidenceBasisPoints},${completenessBasisPoints},${JSON.stringify(evidence.map((item: any) => item.id))},${JSON.stringify(findings.map((item: any) => item.id))},${latest?.id ?? null},${reportHash},${canonicalPayload},${report.generatedAt}) ON CONFLICT (tenant_id,passport_id,report_type,canonical_payload_hash) DO NOTHING`);
  return { ...report, reportHash };
}
