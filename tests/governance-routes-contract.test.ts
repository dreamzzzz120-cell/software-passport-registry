import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = () => read('src/routes/governance.ts');

describe('governance router RBAC: internal governance data is never Client-readable', () => {
  it('defines the shared non-Client role list and applies it to every read route', () => {
    const s = source();
    expect(s).toContain("const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];");
    expect(s).toContain("router.get('/policies', requireAuth, requireRole(NOT_CLIENT_ROLE)");
    expect(s).toContain("router.get('/controls', requireAuth, requireRole(NOT_CLIENT_ROLE)");
    expect(s).toContain("router.get('/risks', requireAuth, requireRole(NOT_CLIENT_ROLE)");
    expect(s).toContain("router.get('/frameworks', requireAuth, requireRole(NOT_CLIENT_ROLE)");
  });

  it('restricts policy/control/risk creation and risk acceptance to Owner/Admin only', () => {
    const s = source();
    expect(s).toContain("const WRITE_ROLE = ['Owner', 'Admin'];");
    expect(s).toContain("router.post('/policies', requireAuth, requireRole(WRITE_ROLE)");
    expect(s).toContain("router.post('/controls', requireAuth, requireRole(WRITE_ROLE)");
    expect(s).toContain("router.post('/risks', requireAuth, requireRole(WRITE_ROLE)");
    expect(s).toContain("router.post('/risks/:id/accept', requireAuth, requireRole(WRITE_ROLE)");
  });

  it('allows Technician to record control tests and finding dispositions, but not to write policies/controls/risks', () => {
    const s = source();
    expect(s).toContain("const TEST_ROLE = ['Owner', 'Admin', 'Technician'];");
    expect(s).toContain("router.post('/controls/:id/tests', requireAuth, requireRole(TEST_ROLE)");
    expect(s).toContain("router.post('/findings/:findingId/dispositions', requireAuth, requireRole(TEST_ROLE)");
  });
});

describe('governance router is mounted in server.ts', () => {
  it('mounts createGovernanceRouter at /api/governance', () => {
    const s = read('server.ts');
    expect(s).toContain("import { createGovernanceRouter } from './src/routes/governance.ts';");
    expect(s).toContain("app.use('/api/governance', createGovernanceRouter());");
  });
});

describe('policy approval is a distinct, explicit action', () => {
  it('never lets an ordinary PATCH set approval_status/approver_name/approved_at', () => {
    const s = source();
    const patchStart = s.indexOf("router.patch('/policies/:id'");
    const patchEnd = s.indexOf("router.post('/policies/:id/approve'");
    const patchBody = s.slice(patchStart, patchEnd);
    const updateSetClause = patchBody.slice(patchBody.indexOf('UPDATE policies SET'), patchBody.indexOf('WHERE id ='));
    expect(updateSetClause).not.toContain('approval_status');
    expect(updateSetClause).not.toContain('approver_name');
  });

  it('the approve route requires an approver name and records who approved it', () => {
    const s = source();
    expect(s).toContain("const policyApproveSchema = z.object({ approverName: z.string().trim().min(1).max(255) }).strict();");
    expect(s).toContain("approval_status = 'APPROVED', approver_name = ${parsed.data.approverName}");
  });
});

describe('risk acceptance requires the full authorized-decision record atomically', () => {
  it('the accept route requires acceptedBy, rationale, scope, and reviewDate together, matching the DB CHECK constraint', () => {
    const s = source();
    expect(s).toMatch(/riskAcceptSchema = z\.object\(\{[\s\S]*?acceptedBy:[\s\S]*?acceptanceRationale:[\s\S]*?acceptanceScope:[\s\S]*?reviewDate:[\s\S]*?\}\)\.strict\(\);/);
  });

  it('acceptance is recorded to the tamper-evident audit trail, not just the risks table', () => {
    const s = source();
    const acceptStart = s.indexOf("router.post('/risks/:id/accept'");
    const acceptBody = s.slice(acceptStart, acceptStart + 2000);
    expect(acceptBody).toContain("appendAuditEntry(db, { tenantId, action: 'governance.risk.acceptance_recorded'");
  });
});

describe('control test PASS-requires-evidence is enforced at the database, surfaced as a clean 400', () => {
  it('catches the CHECK constraint violation (23514) and returns PASS_REQUIRES_EVIDENCE', () => {
    const s = source();
    const testPostStart = s.indexOf("router.post('/controls/:id/tests'");
    const testPostBody = s.slice(testPostStart, testPostStart + 2600);
    expect(testPostBody).toContain("error?.code === '23514' || error?.cause?.code === '23514'");
    expect(testPostBody).toContain('PASS_REQUIRES_EVIDENCE');
  });
});

describe('framework requirements can never be silently marked as a verified source', () => {
  it('surfaces the DB CHECK (VERIFIED_SOURCE requires authoritative_source) as a clean 400', () => {
    const s = source();
    const reqPostStart = s.indexOf("router.post('/frameworks/:id/requirements'");
    const reqPostBody = s.slice(reqPostStart, reqPostStart + 1800);
    expect(reqPostBody).toContain('VERIFIED_SOURCE_REQUIRES_AUTHORITATIVE_SOURCE');
  });

  it('requirement schema defaults to REQUIRES_SOURCE_VERIFICATION, never assuming a source is trustworthy by default', () => {
    const s = source();
    expect(s).toContain("status: z.enum(['REQUIRES_SOURCE_VERIFICATION', 'VERIFIED_SOURCE']).default('REQUIRES_SOURCE_VERIFICATION'),");
  });
});

describe('finding dispositions never touch the finding\'s real evidence-derived status', () => {
  it('only inserts into finding_dispositions, never UPDATEs trust_findings.status', () => {
    const s = source();
    const dispPostStart = s.indexOf("router.post('/findings/:findingId/dispositions'");
    const dispPostBody = s.slice(dispPostStart, dispPostStart + 1500);
    expect(dispPostBody).toContain('INSERT INTO finding_dispositions');
    expect(dispPostBody).not.toMatch(/UPDATE\s+trust_findings/);
  });

  it('verifies the finding belongs to the caller\'s tenant before allowing a disposition', () => {
    const s = source();
    const dispPostStart = s.indexOf("router.post('/findings/:findingId/dispositions'");
    const dispPostBody = s.slice(dispPostStart, dispPostStart + 800);
    expect(dispPostBody).toContain('FROM trust_findings WHERE id = ${req.params.findingId} AND tenant_id = ${tenantId}');
  });

  it('a rationale-required CHECK violation (23514) surfaces as a clean 400, not a 500', () => {
    const s = source();
    const dispPostStart = s.indexOf("router.post('/findings/:findingId/dispositions'");
    const dispPostBody = s.slice(dispPostStart, dispPostStart + 2200);
    expect(dispPostBody).toContain('RATIONALE_REQUIRED_FOR_THIS_DISPOSITION');
  });
});

describe('every mutation is scoped by tenant_id in its WHERE clause', () => {
  it('PATCH/accept routes never update a row without also matching tenant_id', () => {
    const s = source();
    const patchPolicy = s.slice(s.indexOf("router.patch('/policies/:id'"), s.indexOf("router.post('/policies/:id/approve'"));
    expect(patchPolicy).toContain('AND tenant_id = ${tenantId}');
    const patchControl = s.slice(s.indexOf("router.patch('/controls/:id'"), s.indexOf("router.get('/controls/:id/tests'"));
    expect(patchControl).toContain('AND tenant_id = ${tenantId}');
    const patchRisk = s.slice(s.indexOf("router.patch('/risks/:id'"), s.indexOf("router.post('/risks/:id/accept'"));
    expect(patchRisk).toContain('AND tenant_id = ${tenantId}');
  });
});

describe('GET /governance/findings is real, tenant-scoped, and server-side filterable', () => {
  it('joins the real trust_findings/passports tables, never a mock list', () => {
    const s = source();
    const start = s.indexOf("router.get('/findings'");
    const body = s.slice(start, start + 1400);
    expect(body).toContain('FROM trust_findings f');
    expect(body).toContain('LEFT JOIN passports p');
    expect(body).toContain('WHERE f.tenant_id = ${tenantId}');
  });

  it('status and search filters are applied in SQL, not faked client-side', () => {
    const s = source();
    const start = s.indexOf("router.get('/findings'");
    const body = s.slice(start, start + 1400);
    expect(body).toContain('f.status = ${statusFilter}');
    expect(body).toContain('f.title ILIKE');
  });
});

describe('WHY / provenance routes trace the real evidence chain, never invent an explanation', () => {
  it('why/finding reuses the finding\'s real evidence_ids, never a separate computation', () => {
    const s = source();
    const start = s.indexOf("router.get('/why/finding/:id'");
    const body = s.slice(start, start + 1400);
    expect(body).toContain('FROM trust_findings WHERE id = ${req.params.id} AND tenant_id = ${tenantId}');
    expect(body).toContain('evidenceChain(db, tenantId, evidenceIds)');
  });

  it('why/control reuses the latest real control_tests row, never a separate computation', () => {
    const s = source();
    const start = s.indexOf("router.get('/why/control/:id'");
    const body = s.slice(start, start + 1600);
    expect(body).toContain('FROM control_tests WHERE tenant_id = ${tenantId} AND control_id = ${req.params.id} ORDER BY tested_at DESC LIMIT 1');
  });

  it('reports exactly which referenced evidence IDs are missing, rather than silently omitting them', () => {
    const s = source();
    expect(s).toContain('missingIds: evidenceIds.filter((id) => !found.has(id))');
    expect(s).toContain('is referenced by the latest test but no longer exists in the evidence ledger');
  });

  it('a control with no test at all is reported as incomplete, never defaulted to complete', () => {
    const s = source();
    const start = s.indexOf("router.get('/why/control/:id'");
    const body = s.slice(start, start + 1200);
    expect(body).toContain('No control test has been recorded for this control yet');
    expect(body).toContain('chainComplete: false');
  });
});

describe('migration 0041 creates the governance schema with tenant RLS and honest defaults', () => {
  it('every tenant-scoped governance table gets RLS + spr_tenant_isolation', () => {
    const s = read('migrations/0041_governance_schema.sql');
    for (const table of ['policies', 'controls', 'tenant_requirement_mappings', 'control_tests', 'risks', 'finding_dispositions']) {
      expect(s).toContain(`'${table}'`);
    }
    expect(s).toContain('ENABLE ROW LEVEL SECURITY');
    expect(s).toContain('spr_tenant_isolation');
  });

  it('frameworks are seeded with catalog identity only, defaulting to REQUIRES_SOURCE_VERIFICATION -- no requirement text is invented', () => {
    const s = read('migrations/0041_governance_schema.sql');
    expect(s).toContain("DEFAULT 'REQUIRES_SOURCE_VERIFICATION'");
    expect(s).not.toContain('INSERT INTO compliance_requirements');
  });

  it('trust_findings.status is never altered -- the governance layer is additive only', () => {
    const s = read('migrations/0041_governance_schema.sql');
    expect(s).not.toMatch(/ALTER TABLE trust_findings/);
  });

  it('the risks table CHECK constraint requires the full acceptance record atomically', () => {
    const s = read('migrations/0041_governance_schema.sql');
    expect(s).toMatch(/CHECK \(acceptance_status != 'ACCEPTED' OR \(accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND acceptance_rationale IS NOT NULL AND acceptance_scope IS NOT NULL AND review_date IS NOT NULL\)\)/);
  });

  it('the control_tests table CHECK constraint forbids PASS without evidence', () => {
    const s = read('migrations/0041_governance_schema.sql');
    expect(s).toContain("CHECK (result != 'PASS' OR evidence_ids != '[]')");
  });
});
