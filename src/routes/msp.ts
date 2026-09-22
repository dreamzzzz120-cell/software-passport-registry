import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry, verifyAuditChain } from '../security/audit-log.ts';

const assignSchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  technicianUserId: z.number().int().positive().optional(),
  technicianDisplay: z.string().trim().min(1).max(255),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

export function createMspRouter() {
  const router = Router();

  router.get('/assignments', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const isClient = req.user!.role === 'Client';
      const clientId = req.user!.clientId;
      if (isClient && !clientId) return res.status(403).json({ error: 'Client account has invalid client configuration' });
      const rows = await db.execute(sql`SELECT id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at FROM client_assignments WHERE tenant_id=${tenantId} AND (${isClient ? sql`client_id = ${clientId}` : sql`TRUE`}) ORDER BY updated_at DESC`);
      return res.json({ assignments: (rows as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.put('/assignments', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const client = (await db.execute(sql`SELECT id FROM clients WHERE id=${parsed.data.clientId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
      const now = new Date().toISOString();
      const row = (await db.execute(sql`
        INSERT INTO client_assignments (id, tenant_id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at)
        VALUES (${id('assign')}, ${tenantId}, ${parsed.data.clientId}, ${parsed.data.technicianUserId ?? null}, ${parsed.data.technicianDisplay}, ${req.user!.email}, ${now}, ${now})
        ON CONFLICT (tenant_id, client_id) DO UPDATE SET technician_user_id=EXCLUDED.technician_user_id, technician_display=EXCLUDED.technician_display, assigned_by=EXCLUDED.assigned_by, updated_at=EXCLUDED.updated_at
        RETURNING id, client_id, technician_display
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'client.technician_assigned', actor: req.user!.email, payload: { clientId: parsed.data.clientId, technicianDisplay: parsed.data.technicianDisplay } });
      return res.status(200).json(row);
    } catch (error) { return next(error); }
  });

  router.delete('/assignments/:clientId', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`DELETE FROM client_assignments WHERE tenant_id=${tenantId} AND client_id=${req.params.clientId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'ASSIGNMENT_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'client.technician_unassigned', actor: req.user!.email, payload: { clientId: req.params.clientId } });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  // Full tenant-scoped MSP audit export. Internal MSP roles only.
  router.get('/audit-export', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const [tenant, clients, passports, findings, evidence, observations, remediation, controls, policies, risks, schedules, auditTrail, auditIntegrity] = await Promise.all([
        db.execute(sql`SELECT id, name, created_at AS "createdAt" FROM tenants WHERE id=${tenantId} LIMIT 1`),
        db.execute(sql`SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt" FROM clients WHERE tenant_id=${tenantId} ORDER BY name ASC`),
        db.execute(sql`SELECT id, name, version, client_id AS "clientId", overall_score AS "overallScore", security_score AS "securityScore", compliance_score AS "complianceScore", verification_status AS "verificationStatus", evidence_completeness AS "evidenceCompleteness", created_at AS "createdAt", updated_at AS "updatedAt" FROM passports WHERE tenant_id=${tenantId} ORDER BY name ASC`),
        db.execute(sql`SELECT id, passport_id AS "passportId", control_id AS "controlId", title, severity, status, description, remediation, updated_at AS "updatedAt", resolved_at AS "resolvedAt" FROM trust_findings WHERE tenant_id=${tenantId} ORDER BY updated_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, passport_id AS "passportId", provider, control_id AS "controlId", subject, source_url AS "sourceUrl", observed_at AS "observedAt", verification_method AS "verificationMethod", status, severity, evidence_hash AS "evidenceHash", limitation FROM evidence_ledger WHERE tenant_id=${tenantId} ORDER BY observed_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, passport_id AS "passportId", observation_version AS "observationVersion", generated_at AS "generatedAt", canonical_payload_hash AS "canonicalPayloadHash", completeness_basis_points AS "completenessBasisPoints", open_finding_count AS "openFindingCount", unknown_dimension_count AS "unknownDimensionCount" FROM trust_observations WHERE tenant_id=${tenantId} ORDER BY generated_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, passport_id AS "passportId", status, priority, owner_display AS "ownerDisplay", updated_at AS "updatedAt", resolved_at AS "resolvedAt" FROM trust_remediation_work_items WHERE tenant_id=${tenantId} ORDER BY updated_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, control_key AS "controlKey", name, implementation_status AS "implementationStatus", frequency, last_tested_at AS "lastTestedAt", next_test_due_at AS "nextTestDueAt", updated_at AS "updatedAt" FROM controls WHERE tenant_id=${tenantId} ORDER BY control_key ASC`),
        db.execute(sql`SELECT id, policy_key AS "policyKey", name, version, status, approval_status AS "approvalStatus", effective_date AS "effectiveDate", review_date AS "reviewDate", updated_at AS "updatedAt" FROM policies WHERE tenant_id=${tenantId} ORDER BY policy_key ASC`),
        db.execute(sql`SELECT id, title, category, likelihood, impact, residual_likelihood AS "residualLikelihood", residual_impact AS "residualImpact", acceptance_status AS "acceptanceStatus", accepted_by AS "acceptedBy", accepted_at AS "acceptedAt", review_date AS "reviewDate", updated_at AS "updatedAt" FROM risks WHERE tenant_id=${tenantId} ORDER BY updated_at DESC`),
        db.execute(sql`SELECT id, client_id AS "clientId", frequency, target_email AS "targetEmail", status, last_audit_at AS "lastAuditAt", next_audit_at AS "nextAuditAt", created_at AS "createdAt" FROM compliance_schedules WHERE tenant_id=${tenantId} ORDER BY created_at DESC`),
        db.execute(sql`SELECT id, action, timestamp, actor, payload, previous_hash AS "previousHash", current_hash AS "currentHash" FROM audit_trail WHERE tenant_id=${tenantId} ORDER BY id DESC LIMIT 10000`),
        verifyAuditChain(db, tenantId),
      ]);
      const payload = {
        schemaVersion: 'spr.msp.audit-export.v1',
        generatedAt: new Date().toISOString(),
        tenantId,
        tenant: (tenant as any).rows?.[0] ?? { id: tenantId },
        counts: {
          clients: (clients as any).rows?.length ?? 0, passports: (passports as any).rows?.length ?? 0,
          findings: (findings as any).rows?.length ?? 0, evidence: (evidence as any).rows?.length ?? 0,
          observations: (observations as any).rows?.length ?? 0, remediation: (remediation as any).rows?.length ?? 0,
          controls: (controls as any).rows?.length ?? 0, policies: (policies as any).rows?.length ?? 0,
          risks: (risks as any).rows?.length ?? 0, schedules: (schedules as any).rows?.length ?? 0,
          auditEvents: (auditTrail as any).rows?.length ?? 0,
        },
        auditIntegrity,
        clients: (clients as any).rows ?? [], passports: (passports as any).rows ?? [],
        findings: (findings as any).rows ?? [], evidence: (evidence as any).rows ?? [],
        observations: (observations as any).rows ?? [], remediation: (remediation as any).rows ?? [],
        controls: (controls as any).rows ?? [], policies: (policies as any).rows ?? [],
        risks: (risks as any).rows ?? [], complianceSchedules: (schedules as any).rows ?? [],
        auditTrail: (auditTrail as any).rows ?? [],
        limitations: ['Recorded application evidence only; this export is not a certification or independent auditor opinion.', 'Collections are capped at 10,000 records per collection.'],
      };
      const exportHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      await appendAuditEntry(db, { tenantId, action: 'msp.audit_export.generated', actor: req.user!.email, payload: { exportHash, format: 'json+pdf-source', counts: payload.counts } });
      res.setHeader('X-SPR-Audit-Export-Hash', exportHash);
      return res.json({ ...payload, exportHash });
    } catch (error) { return next(error); }
  });

  // MSP commercial usage is measured in Active Passports: unique passports
  // with enabled continuous integration monitoring. This deliberately excludes
  // one-off scans and historical/inactive passports from the billable meter.
  router.get('/usage', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const subscription = (await db.execute(sql`SELECT plan, status, client_limit AS "activePassportLimit" FROM tenant_subscriptions WHERE tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0] ?? null;
      const usage = (await db.execute(sql`SELECT COUNT(DISTINCT passport_id)::int AS "activePassports" FROM monitoring_configurations WHERE tenant_id=${tenantId} AND subject_type='integration_provider' AND enabled=true`) as any).rows?.[0];
      const activePassports = Number(usage?.activePassports ?? 0);
      const limit = subscription?.activePassportLimit == null ? null : Number(subscription.activePassportLimit);
      return res.json({
        billingUnit: 'active_passport',
        definition: 'Unique passport with at least one enabled integration-monitoring configuration.',
        plan: subscription?.plan ?? null,
        subscriptionStatus: subscription?.status ?? 'none',
        activePassports,
        includedActivePassports: limit,
        remaining: limit == null ? null : Math.max(0, limit - activePassports),
        overLimit: limit != null && activePassports > limit,
      });
    } catch (error) { return next(error); }
  });

  return router;
}
