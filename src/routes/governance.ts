/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

// Governance & Compliance is MSP-internal (policies, controls, risk
// acceptance) -- never Client-readable, same reasoning as Vendor Risk and
// Time & Savings.
const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];
const WRITE_ROLE = ['Owner', 'Admin'];
const TEST_ROLE = ['Owner', 'Admin', 'Technician'];

function newId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

const policySchema = z.object({
  policyKey: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).default(''),
  content: z.string().trim().max(50000).default(''),
  ownerName: z.string().trim().max(255).default(''),
}).strict();

const policyPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(4000).optional(),
  content: z.string().trim().max(50000).optional(),
  ownerName: z.string().trim().max(255).optional(),
  version: z.string().trim().min(1).max(40).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED']).optional(),
  effectiveDate: z.string().trim().max(40).nullable().optional(),
  reviewDate: z.string().trim().max(40).nullable().optional(),
  relatedControlIds: z.array(z.string()).optional(),
  relatedRequirementIds: z.array(z.string()).optional(),
}).strict();

// A policy may only carry APPROVED_STATUS metadata (approverName/approvedAt)
// through this one dedicated action -- never as a side effect of an
// ordinary field edit, so the UI can never accidentally imply legal/
// management sign-off happened when it didn't.
const policyApproveSchema = z.object({ approverName: z.string().trim().min(1).max(255) }).strict();

const controlSchema = z.object({
  controlKey: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(255),
  objective: z.string().trim().max(2000).default(''),
  description: z.string().trim().max(4000).default(''),
  ownerName: z.string().trim().max(255).default(''),
  frequency: z.string().trim().max(120).default(''),
  evidenceRequirements: z.string().trim().max(2000).default(''),
  testingMethod: z.string().trim().max(2000).default(''),
}).strict();

const controlPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  objective: z.string().trim().max(2000).optional(),
  description: z.string().trim().max(4000).optional(),
  ownerName: z.string().trim().max(255).optional(),
  frequency: z.string().trim().max(120).optional(),
  implementationStatus: z.enum(['NOT_IMPLEMENTED', 'IMPLEMENTED', 'TESTING', 'VERIFIED', 'FAILED', 'NEEDS_REVIEW', 'NOT_APPLICABLE']).optional(),
  evidenceRequirements: z.string().trim().max(2000).optional(),
  testingMethod: z.string().trim().max(2000).optional(),
  relatedPolicyIds: z.array(z.string()).optional(),
  relatedRiskIds: z.array(z.string()).optional(),
}).strict();

const controlTestSchema = z.object({
  testerName: z.string().trim().min(1).max(255),
  methodology: z.string().trim().max(2000).default(''),
  expectedResult: z.string().trim().max(2000).default(''),
  actualResult: z.string().trim().max(2000).default(''),
  evidenceIds: z.array(z.string()).default([]),
  notes: z.string().trim().max(2000).default(''),
  result: z.enum(['PASS', 'FAIL', 'PARTIAL', 'UNKNOWN', 'NEEDS_REVIEW']),
}).strict();

const riskSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).default(''),
  category: z.string().trim().max(120).default(''),
  likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  relatedControlIds: z.array(z.string()).default([]),
  relatedFindingIds: z.array(z.string()).default([]),
  mitigation: z.string().trim().max(4000).default(''),
  ownerName: z.string().trim().max(255).default(''),
}).strict();

const riskPatchSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(120).optional(),
  likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  mitigation: z.string().trim().max(4000).optional(),
  residualLikelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
  residualImpact: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
  ownerName: z.string().trim().max(255).optional(),
}).strict();

// Risk acceptance is a distinct, deliberate action -- not a field on the
// general patch -- because the spec requires an authorized person, date,
// scope, and rationale to exist together, atomically, matching the DB CHECK
// constraint on the risks table.
const riskAcceptSchema = z.object({
  acceptedBy: z.string().trim().min(1).max(255),
  acceptanceRationale: z.string().trim().min(1).max(4000),
  acceptanceScope: z.string().trim().min(1).max(2000),
  reviewDate: z.string().trim().min(1).max(40),
  status: z.enum(['ACCEPTED', 'MITIGATED', 'TRANSFERRED']),
}).strict();

const dispositionSchema = z.object({
  disposition: z.enum(['IN_PROGRESS', 'MITIGATED', 'ACCEPTED_RISK', 'FALSE_POSITIVE', 'NEEDS_REVIEW']),
  ownerName: z.string().trim().max(255).optional(),
  dueDate: z.string().trim().max(40).optional(),
  businessImpact: z.string().trim().max(2000).default(''),
  technicalImpact: z.string().trim().max(2000).default(''),
  rationale: z.string().trim().max(4000).default(''),
  relatedRiskId: z.string().trim().max(120).optional(),
}).strict();

const requirementSchema = z.object({
  requirementKey: z.string().trim().min(1).max(120),
  requirementText: z.string().trim().max(4000).default(''),
  authoritativeSource: z.string().trim().max(2000).optional(),
  jurisdiction: z.string().trim().max(255).default(''),
  applicability: z.string().trim().max(2000).default(''),
  status: z.enum(['REQUIRES_SOURCE_VERIFICATION', 'VERIFIED_SOURCE']).default('REQUIRES_SOURCE_VERIFICATION'),
}).strict();

const requirementMappingSchema = z.object({
  relatedControlIds: z.array(z.string()).default([]),
  status: z.enum(['SUPPORTED', 'PARTIAL', 'NOT_SUPPORTED', 'UNKNOWN', 'NEEDS_REVIEW']),
  notes: z.string().trim().max(2000).default(''),
}).strict();

function publicPolicy(row: any) {
  return {
    id: row.id, policyKey: row.policyKey, name: row.name, description: row.description, content: row.content,
    ownerName: row.ownerName, version: row.version, status: row.status, effectiveDate: row.effectiveDate,
    reviewDate: row.reviewDate, approvalStatus: row.approvalStatus, approverName: row.approverName, approvedAt: row.approvedAt,
    relatedControlIds: JSON.parse(row.relatedControlIds || '[]'), relatedRequirementIds: JSON.parse(row.relatedRequirementIds || '[]'),
    createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function publicControl(row: any) {
  return {
    id: row.id, controlKey: row.controlKey, name: row.name, objective: row.objective, description: row.description,
    ownerName: row.ownerName, frequency: row.frequency, implementationStatus: row.implementationStatus,
    evidenceRequirements: row.evidenceRequirements, testingMethod: row.testingMethod,
    lastTestedAt: row.lastTestedAt, nextTestDueAt: row.nextTestDueAt,
    relatedPolicyIds: JSON.parse(row.relatedPolicyIds || '[]'), relatedRiskIds: JSON.parse(row.relatedRiskIds || '[]'),
    createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function publicRisk(row: any) {
  return {
    id: row.id, title: row.title, description: row.description, category: row.category,
    likelihood: row.likelihood, impact: row.impact, mitigation: row.mitigation,
    residualLikelihood: row.residualLikelihood, residualImpact: row.residualImpact, ownerName: row.ownerName,
    acceptanceStatus: row.acceptanceStatus, acceptedBy: row.acceptedBy, acceptedAt: row.acceptedAt,
    acceptanceRationale: row.acceptanceRationale, acceptanceScope: row.acceptanceScope, reviewDate: row.reviewDate,
    relatedControlIds: JSON.parse(row.relatedControlIds || '[]'), relatedFindingIds: JSON.parse(row.relatedFindingIds || '[]'),
    createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function createGovernanceRouter() {
  const router = Router();

  // ---- Policies -------------------------------------------------------
  router.get('/policies', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT id, policy_key AS "policyKey", name, description, content, owner_name AS "ownerName", version, status,
          effective_date AS "effectiveDate", review_date AS "reviewDate", approval_status AS "approvalStatus",
          approver_name AS "approverName", approved_at AS "approvedAt",
          related_control_ids AS "relatedControlIds", related_requirement_ids AS "relatedRequirementIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM policies WHERE tenant_id = ${req.user!.tenantId} ORDER BY updated_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicPolicy));
    } catch (error) { next(error); }
  });

  router.post('/policies', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, id = newId('policy');
      const row = (await db.execute(sql`
        INSERT INTO policies (id, tenant_id, policy_key, name, description, content, owner_name, created_by)
        VALUES (${id}, ${tenantId}, ${parsed.data.policyKey}, ${parsed.data.name}, ${parsed.data.description}, ${parsed.data.content}, ${parsed.data.ownerName}, ${req.user!.uid})
        RETURNING id, policy_key AS "policyKey", name, description, content, owner_name AS "ownerName", version, status,
          effective_date AS "effectiveDate", review_date AS "reviewDate", approval_status AS "approvalStatus",
          approver_name AS "approverName", approved_at AS "approvedAt",
          related_control_ids AS "relatedControlIds", related_requirement_ids AS "relatedRequirementIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'governance.policy.created', actor: req.user!.uid, payload: { id, policyKey: parsed.data.policyKey, name: parsed.data.name } });
      res.status(201).json(publicPolicy(row));
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') return res.status(409).json({ error: 'POLICY_KEY_ALREADY_EXISTS' });
      next(error);
    }
  });

  router.patch('/policies/:id', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = policyPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, p = parsed.data;
      const before = (await db.execute(sql`SELECT * FROM policies WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!before) return res.status(404).json({ error: 'POLICY_NOT_FOUND' });
      const row = (await db.execute(sql`
        UPDATE policies SET
          name = ${p.name ?? before.name}, description = ${p.description ?? before.description}, content = ${p.content ?? before.content},
          owner_name = ${p.ownerName ?? before.owner_name}, version = ${p.version ?? before.version}, status = ${p.status ?? before.status},
          effective_date = ${p.effectiveDate === undefined ? before.effective_date : p.effectiveDate},
          review_date = ${p.reviewDate === undefined ? before.review_date : p.reviewDate},
          related_control_ids = ${p.relatedControlIds ? JSON.stringify(p.relatedControlIds) : before.related_control_ids},
          related_requirement_ids = ${p.relatedRequirementIds ? JSON.stringify(p.relatedRequirementIds) : before.related_requirement_ids},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, policy_key AS "policyKey", name, description, content, owner_name AS "ownerName", version, status,
          effective_date AS "effectiveDate", review_date AS "reviewDate", approval_status AS "approvalStatus",
          approver_name AS "approverName", approved_at AS "approvedAt",
          related_control_ids AS "relatedControlIds", related_requirement_ids AS "relatedRequirementIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'governance.policy.updated', actor: req.user!.uid, payload: { id: req.params.id, previous: { status: before.status, version: before.version }, next: { status: row.status, version: row.version } } });
      res.json(publicPolicy(row));
    } catch (error) { next(error); }
  });

  // Approval is a deliberate, separate action -- it also always resets
  // approval_status back to NOT_APPROVED whenever ordinary content changes
  // via PATCH would be unsafe to infer automatically, so instead this route
  // is the ONLY way approval_status/approver_name/approved_at ever get set.
  router.post('/policies/:id/approve', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = policyApproveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId;
      const row = (await db.execute(sql`
        UPDATE policies SET approval_status = 'APPROVED', approver_name = ${parsed.data.approverName}, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, policy_key AS "policyKey", name, description, content, owner_name AS "ownerName", version, status,
          effective_date AS "effectiveDate", review_date AS "reviewDate", approval_status AS "approvalStatus",
          approver_name AS "approverName", approved_at AS "approvedAt",
          related_control_ids AS "relatedControlIds", related_requirement_ids AS "relatedRequirementIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'POLICY_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'governance.policy.approved', actor: req.user!.uid, payload: { id: req.params.id, approverName: parsed.data.approverName } });
      res.json(publicPolicy(row));
    } catch (error) { next(error); }
  });

  // ---- Controls ---------------------------------------------------------
  router.get('/controls', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT id, control_key AS "controlKey", name, objective, description, owner_name AS "ownerName", frequency,
          implementation_status AS "implementationStatus", evidence_requirements AS "evidenceRequirements", testing_method AS "testingMethod",
          last_tested_at AS "lastTestedAt", next_test_due_at AS "nextTestDueAt",
          related_policy_ids AS "relatedPolicyIds", related_risk_ids AS "relatedRiskIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM controls WHERE tenant_id = ${req.user!.tenantId} ORDER BY updated_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicControl));
    } catch (error) { next(error); }
  });

  router.post('/controls', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = controlSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, id = newId('control'), c = parsed.data;
      const row = (await db.execute(sql`
        INSERT INTO controls (id, tenant_id, control_key, name, objective, description, owner_name, frequency, evidence_requirements, testing_method, created_by)
        VALUES (${id}, ${tenantId}, ${c.controlKey}, ${c.name}, ${c.objective}, ${c.description}, ${c.ownerName}, ${c.frequency}, ${c.evidenceRequirements}, ${c.testingMethod}, ${req.user!.uid})
        RETURNING id, control_key AS "controlKey", name, objective, description, owner_name AS "ownerName", frequency,
          implementation_status AS "implementationStatus", evidence_requirements AS "evidenceRequirements", testing_method AS "testingMethod",
          last_tested_at AS "lastTestedAt", next_test_due_at AS "nextTestDueAt",
          related_policy_ids AS "relatedPolicyIds", related_risk_ids AS "relatedRiskIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'governance.control.created', actor: req.user!.uid, payload: { id, controlKey: c.controlKey, name: c.name } });
      res.status(201).json(publicControl(row));
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') return res.status(409).json({ error: 'CONTROL_KEY_ALREADY_EXISTS' });
      next(error);
    }
  });

  router.patch('/controls/:id', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = controlPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, p = parsed.data;
      const before = (await db.execute(sql`SELECT * FROM controls WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!before) return res.status(404).json({ error: 'CONTROL_NOT_FOUND' });
      const row = (await db.execute(sql`
        UPDATE controls SET
          name = ${p.name ?? before.name}, objective = ${p.objective ?? before.objective}, description = ${p.description ?? before.description},
          owner_name = ${p.ownerName ?? before.owner_name}, frequency = ${p.frequency ?? before.frequency},
          implementation_status = ${p.implementationStatus ?? before.implementation_status},
          evidence_requirements = ${p.evidenceRequirements ?? before.evidence_requirements}, testing_method = ${p.testingMethod ?? before.testing_method},
          related_policy_ids = ${p.relatedPolicyIds ? JSON.stringify(p.relatedPolicyIds) : before.related_policy_ids},
          related_risk_ids = ${p.relatedRiskIds ? JSON.stringify(p.relatedRiskIds) : before.related_risk_ids},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, control_key AS "controlKey", name, objective, description, owner_name AS "ownerName", frequency,
          implementation_status AS "implementationStatus", evidence_requirements AS "evidenceRequirements", testing_method AS "testingMethod",
          last_tested_at AS "lastTestedAt", next_test_due_at AS "nextTestDueAt",
          related_policy_ids AS "relatedPolicyIds", related_risk_ids AS "relatedRiskIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'governance.control.updated', actor: req.user!.uid, payload: { id: req.params.id, previous: { implementationStatus: before.implementation_status }, next: { implementationStatus: row.implementationStatus } } });
      res.json(publicControl(row));
    } catch (error) { next(error); }
  });

  router.get('/controls/:id/tests', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const owned = (await req.db!.execute(sql`SELECT 1 FROM controls WHERE id = ${req.params.id} AND tenant_id = ${req.user!.tenantId}`) as any).rows?.[0];
      if (!owned) return res.status(404).json({ error: 'CONTROL_NOT_FOUND' });
      const rows = (await req.db!.execute(sql`
        SELECT id, control_id AS "controlId", tester_name AS "testerName", tested_at AS "testedAt", methodology,
          expected_result AS "expectedResult", actual_result AS "actualResult", evidence_ids AS "evidenceIds", notes, result,
          created_by AS "createdBy", created_at AS "createdAt"
        FROM control_tests WHERE tenant_id = ${req.user!.tenantId} AND control_id = ${req.params.id} ORDER BY tested_at DESC
      `) as any).rows ?? [];
      res.json(rows.map((r: any) => ({ ...r, evidenceIds: JSON.parse(r.evidenceIds || '[]') })));
    } catch (error) { next(error); }
  });

  router.post('/controls/:id/tests', requireAuth, requireRole(TEST_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = controlTestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, t = parsed.data;
      const owned = (await db.execute(sql`SELECT 1 FROM controls WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!owned) return res.status(404).json({ error: 'CONTROL_NOT_FOUND' });
      const id = newId('control_test');
      const row = (await db.execute(sql`
        INSERT INTO control_tests (id, tenant_id, control_id, tester_name, methodology, expected_result, actual_result, evidence_ids, notes, result, created_by)
        VALUES (${id}, ${tenantId}, ${req.params.id}, ${t.testerName}, ${t.methodology}, ${t.expectedResult}, ${t.actualResult}, ${JSON.stringify(t.evidenceIds)}, ${t.notes}, ${t.result}, ${req.user!.uid})
        RETURNING id, control_id AS "controlId", tester_name AS "testerName", tested_at AS "testedAt", methodology,
          expected_result AS "expectedResult", actual_result AS "actualResult", evidence_ids AS "evidenceIds", notes, result,
          created_by AS "createdBy", created_at AS "createdAt"
      `) as any).rows?.[0];
      await db.execute(sql`UPDATE controls SET last_tested_at = CURRENT_TIMESTAMP, implementation_status = ${t.result === 'PASS' ? 'VERIFIED' : t.result === 'FAIL' ? 'FAILED' : t.result === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'TESTING'} WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`);
      await appendAuditEntry(db, { tenantId, action: 'governance.control.tested', actor: req.user!.uid, payload: { controlId: req.params.id, result: t.result } });
      res.status(201).json({ ...row, evidenceIds: JSON.parse(row.evidenceIds || '[]') });
    } catch (error: any) {
      // The CHECK constraint (result != 'PASS' OR evidence_ids != '[]') is
      // the real, database-enforced guarantee behind "do not permit PASS
      // where required evidence is missing" -- surface it as a clean 400,
      // not a generic 500.
      if (error?.code === '23514' || error?.cause?.code === '23514') return res.status(400).json({ error: 'PASS_REQUIRES_EVIDENCE' });
      next(error);
    }
  });

  // ---- Frameworks & requirements -----------------------------------------
  router.get('/frameworks', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT id, framework_key AS "frameworkKey", name, version, published_by AS "publishedBy", source_url AS "sourceUrl", status, created_at AS "createdAt"
        FROM compliance_frameworks ORDER BY name
      `) as any).rows ?? [];
      res.json(rows);
    } catch (error) { next(error); }
  });

  router.get('/frameworks/:id/requirements', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT r.id, r.requirement_key AS "requirementKey", r.requirement_text AS "requirementText",
          r.authoritative_source AS "authoritativeSource", r.jurisdiction, r.applicability, r.status, r.review_date AS "reviewDate",
          m.status AS "tenantStatus", m.notes AS "tenantNotes", m.related_control_ids AS "tenantRelatedControlIds"
        FROM compliance_requirements r
        LEFT JOIN tenant_requirement_mappings m ON m.requirement_id = r.id AND m.tenant_id = ${req.user!.tenantId}
        WHERE r.framework_id = ${req.params.id} ORDER BY r.requirement_key
      `) as any).rows ?? [];
      res.json(rows.map((r: any) => ({ ...r, tenantStatus: r.tenantStatus ?? 'UNKNOWN', tenantRelatedControlIds: JSON.parse(r.tenantRelatedControlIds || '[]') })));
    } catch (error) { next(error); }
  });

  // Adding a requirement is intentionally an explicit, separate admin
  // action, never bulk-imported or auto-generated -- the DB CHECK on
  // compliance_requirements independently enforces that a non-empty
  // authoritative_source is present before status can be VERIFIED_SOURCE.
  router.post('/frameworks/:id/requirements', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = requirementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, r = parsed.data, id = newId('requirement');
      const framework = (await db.execute(sql`SELECT 1 FROM compliance_frameworks WHERE id = ${req.params.id}`) as any).rows?.[0];
      if (!framework) return res.status(404).json({ error: 'FRAMEWORK_NOT_FOUND' });
      const row = (await db.execute(sql`
        INSERT INTO compliance_requirements (id, framework_id, requirement_key, requirement_text, authoritative_source, jurisdiction, applicability, status)
        VALUES (${id}, ${req.params.id}, ${r.requirementKey}, ${r.requirementText}, ${r.authoritativeSource ?? null}, ${r.jurisdiction}, ${r.applicability}, ${r.status})
        RETURNING id, requirement_key AS "requirementKey", requirement_text AS "requirementText", authoritative_source AS "authoritativeSource", jurisdiction, applicability, status
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId: req.user!.tenantId, action: 'governance.requirement.added', actor: req.user!.uid, payload: { frameworkId: req.params.id, requirementKey: r.requirementKey, status: r.status } });
      res.status(201).json(row);
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') return res.status(409).json({ error: 'REQUIREMENT_KEY_ALREADY_EXISTS' });
      if (error?.code === '23514' || error?.cause?.code === '23514') return res.status(400).json({ error: 'VERIFIED_SOURCE_REQUIRES_AUTHORITATIVE_SOURCE' });
      next(error);
    }
  });

  router.put('/requirement-mappings/:requirementId', requireAuth, requireRole(TEST_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = requirementMappingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, m = parsed.data;
      const requirement = (await db.execute(sql`SELECT 1 FROM compliance_requirements WHERE id = ${req.params.requirementId}`) as any).rows?.[0];
      if (!requirement) return res.status(404).json({ error: 'REQUIREMENT_NOT_FOUND' });
      const id = newId('req_mapping');
      const row = (await db.execute(sql`
        INSERT INTO tenant_requirement_mappings (id, tenant_id, requirement_id, related_control_ids, status, notes, updated_by)
        VALUES (${id}, ${tenantId}, ${req.params.requirementId}, ${JSON.stringify(m.relatedControlIds)}, ${m.status}, ${m.notes}, ${req.user!.uid})
        ON CONFLICT (tenant_id, requirement_id) DO UPDATE SET
          related_control_ids = EXCLUDED.related_control_ids, status = EXCLUDED.status, notes = EXCLUDED.notes,
          updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
        RETURNING id, requirement_id AS "requirementId", related_control_ids AS "relatedControlIds", status, notes, updated_by AS "updatedBy", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      res.json({ ...row, relatedControlIds: JSON.parse(row.relatedControlIds || '[]') });
    } catch (error) { next(error); }
  });

  // ---- Risk register ------------------------------------------------------
  router.get('/risks', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT id, title, description, category, likelihood, impact, mitigation,
          residual_likelihood AS "residualLikelihood", residual_impact AS "residualImpact", owner_name AS "ownerName",
          acceptance_status AS "acceptanceStatus", accepted_by AS "acceptedBy", accepted_at AS "acceptedAt",
          acceptance_rationale AS "acceptanceRationale", acceptance_scope AS "acceptanceScope", review_date AS "reviewDate",
          related_control_ids AS "relatedControlIds", related_finding_ids AS "relatedFindingIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM risks WHERE tenant_id = ${req.user!.tenantId} ORDER BY updated_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicRisk));
    } catch (error) { next(error); }
  });

  router.post('/risks', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = riskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, id = newId('risk'), r = parsed.data;
      const row = (await db.execute(sql`
        INSERT INTO risks (id, tenant_id, title, description, category, likelihood, impact, related_control_ids, related_finding_ids, mitigation, owner_name, created_by)
        VALUES (${id}, ${tenantId}, ${r.title}, ${r.description}, ${r.category}, ${r.likelihood}, ${r.impact}, ${JSON.stringify(r.relatedControlIds)}, ${JSON.stringify(r.relatedFindingIds)}, ${r.mitigation}, ${r.ownerName}, ${req.user!.uid})
        RETURNING id, title, description, category, likelihood, impact, mitigation,
          residual_likelihood AS "residualLikelihood", residual_impact AS "residualImpact", owner_name AS "ownerName",
          acceptance_status AS "acceptanceStatus", accepted_by AS "acceptedBy", accepted_at AS "acceptedAt",
          acceptance_rationale AS "acceptanceRationale", acceptance_scope AS "acceptanceScope", review_date AS "reviewDate",
          related_control_ids AS "relatedControlIds", related_finding_ids AS "relatedFindingIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'governance.risk.created', actor: req.user!.uid, payload: { id, title: r.title, likelihood: r.likelihood, impact: r.impact } });
      res.status(201).json(publicRisk(row));
    } catch (error) { next(error); }
  });

  router.patch('/risks/:id', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = riskPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, p = parsed.data;
      const before = (await db.execute(sql`SELECT * FROM risks WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!before) return res.status(404).json({ error: 'RISK_NOT_FOUND' });
      const row = (await db.execute(sql`
        UPDATE risks SET
          title = ${p.title ?? before.title}, description = ${p.description ?? before.description}, category = ${p.category ?? before.category},
          likelihood = ${p.likelihood ?? before.likelihood}, impact = ${p.impact ?? before.impact}, mitigation = ${p.mitigation ?? before.mitigation},
          residual_likelihood = ${p.residualLikelihood === undefined ? before.residual_likelihood : p.residualLikelihood},
          residual_impact = ${p.residualImpact === undefined ? before.residual_impact : p.residualImpact},
          owner_name = ${p.ownerName ?? before.owner_name}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, title, description, category, likelihood, impact, mitigation,
          residual_likelihood AS "residualLikelihood", residual_impact AS "residualImpact", owner_name AS "ownerName",
          acceptance_status AS "acceptanceStatus", accepted_by AS "acceptedBy", accepted_at AS "acceptedAt",
          acceptance_rationale AS "acceptanceRationale", acceptance_scope AS "acceptanceScope", review_date AS "reviewDate",
          related_control_ids AS "relatedControlIds", related_finding_ids AS "relatedFindingIds",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      res.json(publicRisk(row));
    } catch (error) { next(error); }
  });

  router.post('/risks/:id/accept', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = riskAcceptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, a = parsed.data;
      const row = (await db.execute(sql`
        UPDATE risks SET acceptance_status = ${a.status}, accepted_by = ${a.acceptedBy}, accepted_at = CURRENT_TIMESTAMP,
          acceptance_rationale = ${a.acceptanceRationale}, acceptance_scope = ${a.acceptanceScope}, review_date = ${a.reviewDate}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, title, acceptance_status AS "acceptanceStatus", accepted_by AS "acceptedBy", accepted_at AS "acceptedAt",
          acceptance_rationale AS "acceptanceRationale", acceptance_scope AS "acceptanceScope", review_date AS "reviewDate"
      `) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'RISK_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'governance.risk.acceptance_recorded', actor: req.user!.uid, payload: { id: req.params.id, status: a.status, acceptedBy: a.acceptedBy, reviewDate: a.reviewDate } });
      res.json(row);
    } catch (error) { next(error); }
  });

  // ---- Finding dispositions (non-destructive governance layer) -----------
  router.get('/findings/:findingId/dispositions', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const owned = (await req.db!.execute(sql`SELECT 1 FROM trust_findings WHERE id = ${req.params.findingId} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!owned) return res.status(404).json({ error: 'FINDING_NOT_FOUND' });
      const rows = (await req.db!.execute(sql`
        SELECT id, finding_id AS "findingId", disposition, owner_name AS "ownerName", due_date AS "dueDate",
          business_impact AS "businessImpact", technical_impact AS "technicalImpact", rationale, related_risk_id AS "relatedRiskId",
          decided_by AS "decidedBy", decided_at AS "decidedAt"
        FROM finding_dispositions WHERE tenant_id = ${tenantId} AND finding_id = ${req.params.findingId} ORDER BY decided_at DESC
      `) as any).rows ?? [];
      res.json(rows);
    } catch (error) { next(error); }
  });

  router.post('/findings/:findingId/dispositions', requireAuth, requireRole(TEST_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = dispositionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, d = parsed.data;
      const finding = (await db.execute(sql`SELECT 1 FROM trust_findings WHERE id = ${req.params.findingId} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!finding) return res.status(404).json({ error: 'FINDING_NOT_FOUND' });
      const id = newId('disposition');
      const row = (await db.execute(sql`
        INSERT INTO finding_dispositions (id, tenant_id, finding_id, disposition, owner_name, due_date, business_impact, technical_impact, rationale, related_risk_id, decided_by)
        VALUES (${id}, ${tenantId}, ${req.params.findingId}, ${d.disposition}, ${d.ownerName ?? null}, ${d.dueDate ?? null}, ${d.businessImpact}, ${d.technicalImpact}, ${d.rationale}, ${d.relatedRiskId ?? null}, ${req.user!.uid})
        RETURNING id, finding_id AS "findingId", disposition, owner_name AS "ownerName", due_date AS "dueDate",
          business_impact AS "businessImpact", technical_impact AS "technicalImpact", rationale, related_risk_id AS "relatedRiskId",
          decided_by AS "decidedBy", decided_at AS "decidedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'governance.finding.disposition_recorded', actor: req.user!.uid, payload: { findingId: req.params.findingId, disposition: d.disposition } });
      res.status(201).json(row);
    } catch (error: any) {
      if (error?.code === '23514' || error?.cause?.code === '23514') return res.status(400).json({ error: 'RATIONALE_REQUIRED_FOR_THIS_DISPOSITION' });
      next(error);
    }
  });

  // ---- Findings (read-only view into the existing, unchanged evidence-
  // derived finding model, for linking into Governance) --------------------
  router.get('/findings', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const rows = (await req.db!.execute(sql`
        SELECT f.id, f.control_id AS "controlId", f.title, f.severity, f.status, f.evidence_ids AS "evidenceIds",
          f.updated_at AS "updatedAt", f.resolved_at AS "resolvedAt", f.passport_id AS "passportId", p.name AS "passportName"
        FROM trust_findings f
        LEFT JOIN passports p ON p.id = f.passport_id AND p.tenant_id = f.tenant_id
        WHERE f.tenant_id = ${tenantId}
          AND (${statusFilter}::text IS NULL OR f.status = ${statusFilter})
          AND (${search}::text = '' OR f.title ILIKE ${'%' + search + '%'} OR f.control_id ILIKE ${'%' + search + '%'})
        ORDER BY CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, f.updated_at DESC
        LIMIT 200
      `) as any).rows ?? [];
      res.json(rows.map((r: any) => ({ ...r, evidenceIds: JSON.parse(r.evidenceIds || '[]') })));
    } catch (error) { next(error); }
  });

  // ---- WHY / provenance: the real evidence chain behind a conclusion ------
  async function evidenceChain(db: any, tenantId: string, evidenceIds: string[]) {
    if (!evidenceIds.length) return { evidence: [], missingIds: [] as string[] };
    const rows = (await db.execute(sql`
      SELECT id, provider, control_id AS "controlId", source_url AS "sourceUrl", observed_at AS "observedAt",
        verification_method AS "verificationMethod", status, severity, evidence_hash AS "evidenceHash", limitation,
        evidence_type AS "evidenceType", confidence_basis_points AS "confidenceBasisPoints", review_at AS "reviewAt"
      FROM evidence_ledger WHERE tenant_id = ${tenantId} AND id = ANY(${evidenceIds})
    `) as any).rows ?? [];
    const found = new Set(rows.map((r: any) => r.id));
    return { evidence: rows, missingIds: evidenceIds.filter((id) => !found.has(id)) };
  }

  router.get('/why/finding/:id', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!, tenantId = req.user!.tenantId;
      const finding = (await db.execute(sql`SELECT id, control_id AS "controlId", title, status, evidence_ids AS "evidenceIds" FROM trust_findings WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!finding) return res.status(404).json({ error: 'FINDING_NOT_FOUND' });
      const evidenceIds = JSON.parse(finding.evidenceIds || '[]');
      const { evidence, missingIds } = await evidenceChain(db, tenantId, evidenceIds);
      const missing: string[] = [];
      if (!evidenceIds.length) missing.push('This finding has no evidence IDs attached, so no provenance chain can be shown.');
      for (const id of missingIds) missing.push(`Evidence ID ${id} is referenced but no longer exists in the evidence ledger.`);
      if (finding.status === 'UNKNOWN') missing.push('This finding\'s evidence-derived status is UNKNOWN -- no verification conclusion has been reached yet.');
      res.json({ conclusion: { type: 'finding', id: finding.id, title: finding.title, status: finding.status }, control: { id: finding.controlId }, evidence, chainComplete: missing.length === 0, missing });
    } catch (error) { next(error); }
  });

  router.get('/why/control/:id', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!, tenantId = req.user!.tenantId;
      const control = (await db.execute(sql`SELECT id, name, implementation_status AS "implementationStatus" FROM controls WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!control) return res.status(404).json({ error: 'CONTROL_NOT_FOUND' });
      const latestTest = (await db.execute(sql`
        SELECT id, result, tested_at AS "testedAt", tester_name AS "testerName", methodology, evidence_ids AS "evidenceIds"
        FROM control_tests WHERE tenant_id = ${tenantId} AND control_id = ${req.params.id} ORDER BY tested_at DESC LIMIT 1
      `) as any).rows?.[0];
      const missing: string[] = [];
      if (!latestTest) {
        missing.push('No control test has been recorded for this control yet -- its implementation status is not backed by any test result.');
        return res.json({ conclusion: { type: 'control', id: control.id, title: control.name, status: control.implementationStatus }, latestTest: null, evidence: [], chainComplete: false, missing });
      }
      const evidenceIds = JSON.parse(latestTest.evidenceIds || '[]');
      const { evidence, missingIds } = await evidenceChain(db, tenantId, evidenceIds);
      if (!evidenceIds.length) missing.push('The most recent test recorded no supporting evidence IDs.');
      for (const id of missingIds) missing.push(`Evidence ID ${id} is referenced by the latest test but no longer exists in the evidence ledger.`);
      res.json({ conclusion: { type: 'control', id: control.id, title: control.name, status: control.implementationStatus }, latestTest, evidence, chainComplete: missing.length === 0, missing });
    } catch (error) { next(error); }
  });

  return router;
}
