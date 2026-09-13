import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/security.ts';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { evaluateVendorRisk } from '../agents/vendor-risk-agent.ts';

const passportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const softwareInput = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const vendorRiskInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.number().int().min(1).max(3650).optional() }).strict();

export function createAgentApiRouter() {
  const router = Router();
  router.use(requireAuth);

  // AI-agent friendly, evidence-first verification surface. It never invents
  // a trust result: missing evidence is represented explicitly as UNKNOWN.
  router.post('/verify-software', async (req: AuthenticatedRequest, res, next) => {
    const parsed = softwareInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const q = parsed.data.query.toLowerCase();
      const passport = (await db.execute(sql`
        SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline
        FROM passports
        WHERE tenant_id=${tenantId} AND (LOWER(name)=${q} OR LOWER(id)=${q})
        LIMIT 1
      `) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', query: parsed.data.query });
      return buildVerificationResponse(db, tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });

  router.post('/verify-passport', async (req: AuthenticatedRequest, res, next) => {
    const parsed = passportInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT_ID', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const passport = (await db.execute(sql`
        SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline
        FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1
      `) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });
      return buildVerificationResponse(db, req.user!.tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });

  router.get('/passport/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const passportId = req.params.passportId;
      const scope = (await db.execute(sql`
        SELECT id,name,overall_score,security_score,compliance_score,evidence,vulnerabilities,timeline
        FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${passportId} LIMIT 1
      `) as any).rows?.[0];
      if (!scope) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId });
      return buildVerificationResponse(db, req.user!.tenantId, scope, res, next);
    } catch (error) { return next(error); }
  });

  // Vendor Risk Agent: deterministic operational review over the same
  // tenant-scoped evidence/findings/observation data used elsewhere in SPR.
  // It cannot mutate trust, scores, findings, compliance, or billing.
  router.post('/vendor-risk', async (req: AuthenticatedRequest, res, next) => {
    const parsed = vendorRiskInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_VENDOR_RISK_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`
        SELECT id,name FROM passports
        WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId}
        LIMIT 1
      `) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId });

      const findings = (await db.execute(sql`
        SELECT id,severity,status,title,updated_at
        FROM trust_findings
        WHERE tenant_id=${tenantId} AND passport_id=${passport.id}
        ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC
        LIMIT 200
      `) as any).rows || [];
      const evidence = (await db.execute(sql`
        SELECT id,provider,observed_at,verification_method,status,limitation
        FROM evidence_ledger
        WHERE tenant_id=${tenantId} AND passport_id=${passport.id}
        ORDER BY observed_at DESC
        LIMIT 500
      `) as any).rows || [];
      const latest = (await db.execute(sql`
        SELECT generated_at,completeness_basis_points
        FROM trust_observations
        WHERE tenant_id=${tenantId} AND passport_id=${passport.id}
        ORDER BY observation_version DESC
        LIMIT 1
      `) as any).rows?.[0];

      const result = evaluateVendorRisk({
        passport: { id: passport.id, name: passport.name },
        findings: findings.map((finding: any) => ({ id: String(finding.id), severity: String(finding.severity || 'unknown'), status: String(finding.status || 'unknown'), title: String(finding.title || 'Untitled finding'), updatedAt: finding.updated_at ? new Date(finding.updated_at).toISOString() : null })),
        evidence: evidence.map((item: any) => ({ id: String(item.id), provider: item.provider == null ? null : String(item.provider), observedAt: item.observed_at ? new Date(item.observed_at).toISOString() : null, verificationMethod: item.verification_method == null ? null : String(item.verification_method), status: item.status == null ? null : String(item.status), limitation: item.limitation == null ? null : String(item.limitation) })),
        latestObservationAt: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null,
        completeness: latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000,
        evaluatedAt: Date.now(),
        staleAfterDays: parsed.data.staleAfterDays,
      });
      return res.json(result);
    } catch (error) { return next(error); }
  });

  return router;
}

async function buildVerificationResponse(db: ScopedDb, tenantId: string, passport: any, res: any, next: any) {
  try {
    const findings = (await db.execute(sql`
      SELECT id,control_id,title,severity,status,description,remediation,evidence_ids,updated_at,resolved_at
      FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id}
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC
    `) as any).rows || [];
    const evidence = (await db.execute(sql`
      SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation
      FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id}
      ORDER BY observed_at DESC LIMIT 200
    `) as any).rows || [];
    const observations = (await db.execute(sql`
      SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count
      FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id}
      ORDER BY observation_version DESC LIMIT 20
    `) as any).rows || [];
    const latest = observations[0];
    const openFindings = findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase()));
    const criticalOrHigh = openFindings.filter((f: any) => ['critical','high'].includes(String(f.severity).toLowerCase()));
    const completeness = latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000;
    let status: 'VERIFIED' | 'INVESTIGATE' | 'AVOID' | 'UNKNOWN' = 'UNKNOWN';
    if (latest && evidence.length > 0) status = criticalOrHigh.length > 0 ? 'AVOID' : openFindings.length > 0 ? 'INVESTIGATE' : 'VERIFIED';
    return res.json({
      schemaVersion: 'spr-agent-v1',
      status,
      software: { passportId: passport.id, name: passport.name },
      // Legacy passport score columns are retained for migration compatibility,
      // but are deliberately never exposed as authoritative verification scores.
      // Trust decisions must come from the evidence ledger and current observation.
      scores: { overall: null, security: null, compliance: null, status: 'not_authoritatively_scored' },
      evidence: { count: evidence.length, completeness, latestObservationAt: latest?.generated_at ?? null, latestHash: latest?.canonical_payload_hash ?? null },
      findings: { total: findings.length, open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: findings.slice(0, 50) },
      verification: { observed: Boolean(latest), evidenceBacked: evidence.length > 0, generatedAt: latest?.generated_at ?? null },
      sources: evidence.slice(0, 50).map((e: any) => ({ provider: e.provider, sourceUrl: e.source_url, observedAt: e.observed_at, verificationMethod: e.verification_method, evidenceHash: e.evidence_hash, limitation: e.limitation })),
      policy: { rule: 'SPR reports observed evidence only; UNKNOWN means insufficient evidence and is not a trust approval.' },
    });
  } catch (error) { return next(error); }
}
