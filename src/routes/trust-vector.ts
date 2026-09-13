/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 12-dimension Trust Vector API. GET computes the vector from the tenant's
 * own records for one passport, stores that computation (so a later reader
 * can see what was said when), and returns it. Nothing here touches the
 * canonical passport score.
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, requireAuth, rateLimiter } from '../middleware/security.ts';
import { computeTrustVector, TRUST_DIMENSIONS, TRUST_VECTOR_VERSION, type TrustVectorInput } from '../trust/trust-vector.ts';

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });

export async function loadTrustVectorInput(db: any, tenantId: string, passportId: string): Promise<TrustVectorInput | null> {
  const passport = ((await db.execute(sql`SELECT id, publisher, sbom, evidence_completeness AS "evidenceCompleteness" FROM passports WHERE id=${passportId} AND tenant_id=${tenantId} LIMIT 1`)) as any).rows?.[0];
  if (!passport) return null;
  let sbomComponentCount: number | null = null;
  try { const parsed = typeof passport.sbom === 'string' ? JSON.parse(passport.sbom) : passport.sbom; if (Array.isArray(parsed)) sbomComponentCount = parsed.length; } catch { sbomComponentCount = null; }

  const jobs = ((await db.execute(sql`SELECT job_type AS "jobType", max(updated_at) AS "completedAt" FROM agent_jobs WHERE tenant_id=${tenantId} AND passport_id=${passportId} AND status='Completed' GROUP BY job_type`)) as any).rows ?? [];
  const completedAt = (type: string) => { const row = jobs.find((j: any) => j.jobType === type); return row?.completedAt ? new Date(row.completedAt).toISOString() : null; };
  const acquired = ((await db.execute(sql`SELECT max(s.acquired_at) AS "acquiredAt" FROM repository_scan_sources s JOIN agent_jobs j ON j.id = s.job_id AND j.tenant_id = s.tenant_id WHERE s.tenant_id=${tenantId} AND j.passport_id=${passportId} AND s.acquired_at IS NOT NULL`)) as any).rows?.[0];
  const observation = ((await db.execute(sql`SELECT max(generated_at) AS "generatedAt" FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passportId}`)) as any).rows?.[0];
  const findings = ((await db.execute(sql`SELECT id, severity, category, status, detected_at AS "detectedAt", fixed_version AS "fixedVersion", component, updated_at AS "updatedAt" FROM scan_findings WHERE tenant_id=${tenantId} AND asset_id=${passportId}`)) as any).rows ?? [];
  const evidence = ((await db.execute(sql`SELECT id, type, verified, status, timestamp FROM evidence_items WHERE tenant_id=${tenantId} AND asset_id=${passportId}`)) as any).rows ?? [];
  const vendorRow = passport.publisher ? ((await db.execute(sql`SELECT v.id, v.last_audit_date AS "lastAuditDate", (SELECT count(*)::int FROM vendor_audits a WHERE a.tenant_id=v.tenant_id AND a.vendor_id=v.id) AS "auditCount", (SELECT max(a.created_at) FROM vendor_audits a WHERE a.tenant_id=v.tenant_id AND a.vendor_id=v.id) AS "lastAuditAt" FROM vendors v WHERE v.tenant_id=${tenantId} AND lower(v.name)=lower(${passport.publisher}) LIMIT 1`)) as any).rows?.[0] : null;
  const monitoring = ((await db.execute(sql`SELECT id, enabled, last_status AS "lastStatus", last_successful_at AS "lastSuccessfulAt" FROM monitoring_configurations WHERE tenant_id=${tenantId} AND passport_id=${passportId}`)) as any).rows ?? [];
  const tasks = ((await db.execute(sql`SELECT rt.id, rt.status FROM remediation_tasks rt JOIN alerts a ON a.id = rt.alert_id AND a.tenant_id = rt.tenant_id WHERE rt.tenant_id=${tenantId} AND a.passport_id=${passportId}`)) as any).rows ?? [];

  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    passportId,
    now: Date.now(),
    evidenceCompleteness: typeof passport.evidenceCompleteness === 'number' ? passport.evidenceCompleteness : null,
    sbomComponentCount,
    lastDependencyScanCompletedAt: completedAt('repository_scan'),
    lastSecurityScanCompletedAt: completedAt('repository_security_scan'),
    lastRepositoryAcquiredAt: iso(acquired?.acquiredAt),
    lastObservationAt: iso(observation?.generatedAt),
    findings: findings.map((f: any) => ({ id: String(f.id), severity: String(f.severity ?? ''), category: String(f.category ?? ''), status: String(f.status ?? 'Open'), detectedAt: f.detectedAt ? String(f.detectedAt) : null, fixedVersion: f.fixedVersion ?? null, component: f.component ?? null, updatedAt: iso(f.updatedAt) })),
    evidence: evidence.map((e: any) => ({ id: String(e.id), type: String(e.type ?? ''), verified: Number(e.verified) === 1, status: String(e.status ?? ''), timestamp: e.timestamp ? String(e.timestamp) : null })),
    vendor: vendorRow ? { id: String(vendorRow.id), auditCount: Number(vendorRow.auditCount ?? 0), lastAuditAt: iso(vendorRow.lastAuditAt) ?? (vendorRow.lastAuditDate ? String(vendorRow.lastAuditDate) : null) } : null,
    monitoring: monitoring.map((m: any) => ({ id: String(m.id), enabled: Number(m.enabled) === 1, lastStatus: String(m.lastStatus ?? 'unknown'), lastSuccessfulAt: m.lastSuccessfulAt ? String(m.lastSuccessfulAt) : null })),
    remediationTasks: tasks.map((t: any) => ({ id: String(t.id), status: String(t.status ?? '') })),
  };
}

export function createTrustVectorRouter() {
  const router = Router();
  router.use(limiter, requireAuth, rateLimiter);

  router.get('/dimensions', (_req, res) => res.json({ version: TRUST_VECTOR_VERSION, dimensions: TRUST_DIMENSIONS }));

  router.get('/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const passportId = String(req.params.passportId ?? '');
      const input = await loadTrustVectorInput(req.db!, tenantId, passportId);
      if (!input) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
      const vector = computeTrustVector(input);
      const id = `tv_${crypto.randomUUID().replace(/-/g, '')}`;
      await req.db!.execute(sql`INSERT INTO passport_trust_vectors (id, tenant_id, passport_id, version, vector_json, computed_at) VALUES (${id}, ${tenantId}, ${passportId}, ${vector.version}, ${JSON.stringify(vector)}::jsonb, ${vector.computedAt}::timestamp)`);
      return res.json({ id, ...vector, authoritative: false });
    } catch (error) { return next(error); }
  });

  router.get('/:passportId/history', async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = ((await req.db!.execute(sql`SELECT id, version, vector_json AS vector, computed_at AS "computedAt" FROM passport_trust_vectors WHERE tenant_id=${req.user!.tenantId} AND passport_id=${String(req.params.passportId)} ORDER BY computed_at DESC LIMIT 30`)) as any).rows ?? [];
      return res.json({ history: rows });
    } catch (error) { return next(error); }
  });

  return router;
}
