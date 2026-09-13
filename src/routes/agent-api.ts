import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/security.ts';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { evaluateVendorRisk } from '../agents/vendor-risk-agent.ts';
import { evaluateCompliance } from '../agents/compliance-agent.ts';
import { evaluateMonitoring } from '../agents/monitoring-agent.ts';
import { buildAgentReport } from '../agents/report-agent.ts';
import { evaluateRevenue } from '../agents/revenue-agent.ts';

const passportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const softwareInput = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const vendorRiskInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.number().int().min(1).max(3650).optional() }).strict();
const complianceInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.number().int().min(1).max(3650).optional() }).strict();
const monitoringInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.number().int().min(1).max(3650).optional() }).strict();
const reportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const revenueInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();

export function createAgentApiRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post('/verify-software', async (req: AuthenticatedRequest, res, next) => {
    const parsed = softwareInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY', details: parsed.error.flatten() });
    try {
      const db = req.db!; const tenantId = req.user!.tenantId; const q = parsed.data.query.toLowerCase();
      const passport = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${tenantId} AND (LOWER(name)=${q} OR LOWER(id)=${q}) LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', query: parsed.data.query });
      return buildVerificationResponse(db, tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });

  router.post('/verify-passport', async (req: AuthenticatedRequest, res, next) => {
    const parsed = passportInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT_ID', details: parsed.error.flatten() });
    try {
      const db = req.db!; const passport = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      return buildVerificationResponse(db, req.user!.tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });

  router.get('/passport/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!; const passportId = req.params.passportId;
      const scope = (await db.execute(sql`SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${passportId} LIMIT 1`) as any).rows?.[0];
      if (!scope) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId });
      return buildVerificationResponse(db, req.user!.tenantId, scope, res, next);
    } catch (error) { return next(error); }
  });

  router.post('/vendor-risk', async (req: AuthenticatedRequest, res, next) => {
    const parsed = vendorRiskInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_VENDOR_RISK_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!; const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      const findings = (await db.execute(sql`SELECT id,severity,status,title,updated_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC LIMIT 200`) as any).rows || [];
      const evidence = (await db.execute(sql`SELECT id,provider,observed_at,verification_method,status,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 500`) as any).rows || [];
      const latest = (await db.execute(sql`SELECT generated_at,completeness_basis_points FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0];
      return res.json(evaluateVendorRisk({ passport: { id: passport.id, name: passport.name }, findings: findings.map((f: any) => ({ id: String(f.id), severity: String(f.severity || 'unknown'), status: String(f.status || 'unknown'), title: String(f.title || 'Untitled finding'), updatedAt: f.updated_at ? new Date(f.updated_at).toISOString() : null })), evidence: evidence.map((e: any) => ({ id: String(e.id), provider: e.provider == null ? null : String(e.provider), observedAt: e.observed_at ? new Date(e.observed_at).toISOString() : null, verificationMethod: e.verification_method == null ? null : String(e.verification_method), status: e.status == null ? null : String(e.status), limitation: e.limitation == null ? null : String(e.limitation) })), latestObservationAt: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null, completeness: latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000, evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays }));
    } catch (error) { return next(error); }
  });

  router.post('/compliance', async (req: AuthenticatedRequest, res, next) => {
    const parsed = complianceInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_COMPLIANCE_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!; const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      const findings = (await db.execute(sql`SELECT id,control_id,severity,status,title FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY control_id ASC, id ASC LIMIT 500`) as any).rows || [];
      const evidence = (await db.execute(sql`SELECT id,control_id,status,observed_at,verification_method,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY control_id ASC, observed_at DESC, id ASC LIMIT 1000`) as any).rows || [];
      return res.json(evaluateCompliance({ passport: { id: passport.id, name: passport.name }, findings: findings.map((f: any) => ({ id: String(f.id), controlId: f.control_id == null ? null : String(f.control_id), severity: String(f.severity || 'unknown'), status: String(f.status || 'unknown'), title: String(f.title || 'Untitled finding') })), evidence: evidence.map((e: any) => ({ id: String(e.id), controlId: e.control_id == null ? null : String(e.control_id), status: e.status == null ? null : String(e.status), observedAt: e.observed_at ? new Date(e.observed_at).toISOString() : null, verificationMethod: e.verification_method == null ? null : String(e.verification_method), limitation: e.limitation == null ? null : String(e.limitation) })), evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays }));
    } catch (error) { return next(error); }
  });

  router.post('/monitoring', async (req: AuthenticatedRequest, res, next) => {
    const parsed = monitoringInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_MONITORING_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!; const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      const observations = (await db.execute(sql`SELECT observation_version,generated_at,evidence_ids,finding_ids,canonical_payload_hash FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 2`) as any).rows || [];
      if (!observations.length) return res.json(evaluateMonitoring({ passport: { id: passport.id, name: passport.name }, previous: [], current: [], evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays }));
      const latest = observations[0]; const previous = observations[1];
      const makeItems = (observation: any) => [...(Array.isArray(observation?.evidence_ids) ? observation.evidence_ids : []), ...(Array.isArray(observation?.finding_ids) ? observation.finding_ids : [])].map((id: unknown) => ({ id: String(id), fingerprint: String(observation.canonical_payload_hash || ''), observedAt: observation.generated_at ? new Date(observation.generated_at).toISOString() : null, status: 'observed' }));
      return res.json(evaluateMonitoring({ passport: { id: passport.id, name: passport.name }, previous: previous ? makeItems(previous) : [], current: makeItems(latest), evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays }));
    } catch (error) { return next(error); }
  });

  router.post('/report', async (req: AuthenticatedRequest, res, next) => {
    const parsed = reportInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REPORT_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!; const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      const findings = (await db.execute(sql`SELECT id,status FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id}`) as any).rows || [];
      const evidence = (await db.execute(sql`SELECT id FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id}`) as any).rows || [];
      const latest = (await db.execute(sql`SELECT generated_at FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0];
      const verification = (await db.execute(sql`SELECT id FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0] ? 'OBSERVED' : 'UNKNOWN';
      return res.json(buildAgentReport({ passport: { id: passport.id, name: passport.name }, verificationStatus: verification, evidenceCount: evidence.length, findingCount: findings.length, openFindingCount: findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase())).length, freshness: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null, evaluatedAt: Date.now() }));
    } catch (error) { return next(error); }
  });

  router.post('/revenue', async (req: AuthenticatedRequest, res, next) => {
    const parsed = revenueInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REVENUE_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!; const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      const findings = (await db.execute(sql`SELECT severity,status FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id}`) as any).rows || [];
      const evidence = (await db.execute(sql`SELECT id,observed_at FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id}`) as any).rows || [];
      const latest = (await db.execute(sql`SELECT generated_at FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0];
      const vendor = evaluateVendorRisk({ passport: { id: passport.id, name: passport.name }, findings: findings.map((f: any, i: number) => ({ id: `finding-${i}`, severity: String(f.severity || 'unknown'), status: String(f.status || 'unknown'), title: 'Observed finding', updatedAt: null })), evidence: evidence.map((e: any) => ({ id: String(e.id), provider: null, observedAt: e.observed_at ? new Date(e.observed_at).toISOString() : null, verificationMethod: null, status: 'observed', limitation: null })), latestObservationAt: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null, completeness: null, evaluatedAt: Date.now() });
      const compliance = evaluateCompliance({ passport: { id: passport.id, name: passport.name }, evidence: [], findings: [], evaluatedAt: Date.now() });
      return res.json(evaluateRevenue({ passport: { id: passport.id, name: passport.name }, openCriticalOrHigh: findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase()) && ['critical','high'].includes(String(f.severity).toLowerCase())).length, openFindings: findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase())).length, stale: !latest, vendorRiskStatus: vendor.status, complianceStatus: compliance.overall, monitoringEnabled: Boolean(latest), observedEvidenceCount: evidence.length, catalog: {} }));
    } catch (error) { return next(error); }
  });

  return router;
}

async function buildVerificationResponse(db: ScopedDb, tenantId: string, passport: any, res: any, next: any) {
  try {
    const findings = (await db.execute(sql`SELECT id,control_id,title,severity,status,description,remediation,evidence_ids,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC`) as any).rows || [];
    const evidence = (await db.execute(sql`SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 200`) as any).rows || [];
    const observations = (await db.execute(sql`SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 20`) as any).rows || [];
    const latest = observations[0];
    const openFindings = findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase()));
    const criticalOrHigh = openFindings.filter((f: any) => ['critical','high'].includes(String(f.severity).toLowerCase()));
    const completeness = latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000;
    let status: 'VERIFIED' | 'INVESTIGATE' | 'AVOID' | 'UNKNOWN' = 'UNKNOWN';
    if (latest && evidence.length > 0) status = criticalOrHigh.length > 0 ? 'AVOID' : openFindings.length > 0 ? 'INVESTIGATE' : 'VERIFIED';
    return res.json({ schemaVersion: 'spr-agent-v1', status, software: { passportId: passport.id, name: passport.name }, scores: { overall: null, security: null, compliance: null, status: 'not_authoritatively_scored' }, evidence: { count: evidence.length, completeness, latestObservationAt: latest?.generated_at ?? null, latestHash: latest?.canonical_payload_hash ?? null }, findings: { total: findings.length, open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: findings.slice(0, 50) }, verification: { observed: Boolean(latest), evidenceBacked: evidence.length > 0, generatedAt: latest?.generated_at ?? null }, sources: evidence.slice(0, 50).map((e: any) => ({ provider: e.provider, sourceUrl: e.source_url, observedAt: e.observed_at, verificationMethod: e.verification_method, evidenceHash: e.evidence_hash, limitation: e.limitation })), policy: { rule: 'SPR reports observed evidence only; UNKNOWN means insufficient evidence and is not a trust approval.' } });
  } catch (error) { return next(error); }
}
