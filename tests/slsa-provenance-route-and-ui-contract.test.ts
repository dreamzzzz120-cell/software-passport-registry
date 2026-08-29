import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('POST /api/passports/:id/evidence/slsa-provenance', () => {
  const source = () => read('src/routes/auth.ts');
  const routeBody = () => {
    const s = source();
    const start = s.indexOf("router.post('/passports/:id/evidence/slsa-provenance'");
    const end = s.indexOf('\n  });', start);
    return s.slice(start, end);
  };

  it('requires authentication and an Owner/Admin/Operator role, matching the scan-trigger routes', () => {
    expect(source()).toContain("router.post('/passports/:id/evidence/slsa-provenance', requireAuth, requireRole(['Owner', 'Admin', 'Operator'])");
  });

  it('is scoped to the caller\'s own tenant when looking up the passport', () => {
    const body = routeBody();
    expect(body).toContain('WHERE id=${passportId} AND tenant_id=${tenantId}');
  });

  it('independently re-verifies the submitted statement -- it never trusts the caller\'s claim', () => {
    const body = routeBody();
    expect(body).toContain('verifySlsaProvenance(parsed.data.statement, parsed.data.hash)');
  });

  it('never accumulates duplicate SLSA rows -- a prior result for this passport is replaced, not appended', () => {
    const body = routeBody();
    expect(body).toContain("DELETE FROM evidence_items WHERE tenant_id=${tenantId} AND asset_id=${passportId} AND type='Attestation' AND name='SLSA Provenance Attestation'");
  });

  it('records the DB status/verified flag from the independent verification result, not a hardcoded value', () => {
    const body = routeBody();
    expect(body).toContain("${result.outcome === 'VERIFIED' ? 1 : 0}, ${result.outcome}");
  });

  it('audits both a verified and a failed outcome', () => {
    const body = routeBody();
    expect(body).toContain("result.outcome === 'VERIFIED' ? 'evidence.slsa_provenance.verified' : 'evidence.slsa_provenance.failed'");
  });

  it('recomputes the passport\'s trust score through the single canonical scoring engine after recording new evidence', () => {
    const body = routeBody();
    expect(body).toContain('await calculateAndStoreTrustScore(passportId, tenantId);');
  });

  it('GET /user/passports surfaces rawContent and failureReason so the UI can render real evidence detail', () => {
    const s = source();
    expect(s).toContain("'failureReason', e.verification_failure_reason, 'rawContent', e.raw_content");
  });
});

describe('SoftwareLineageTracker no longer fabricates provenance data', () => {
  const source = () => read('src/components/SoftwareLineageTracker.tsx');

  it('contains none of the previously-fabricated repo/commit/CI/signing values', () => {
    const s = source();
    expect(s).not.toContain('enterprise-registry');
    expect(s).not.toContain('f4b3c2a1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5');
    expect(s).not.toContain('SLSA Level 4 Compliant');
    expect(s).not.toContain('Cosign Sigstore Root CA');
    expect(s).not.toContain('GitHub Actions Cloud Build');
    expect(s).not.toContain('run-98421-prod-');
  });

  it('derives SLSA state from the real evidence array, not a generated object', () => {
    const s = source();
    expect(s).toContain("(activePassport.evidence || []).find((item) => item.type === 'Attestation' && /slsa/i.test(item.name))");
  });

  it('"SLSA Provenance — Verified" can only render when a real evidence item has status VERIFIED', () => {
    const s = source();
    const verifiedBranch = s.indexOf("slsaEvidence && slsaEvidence.status === 'VERIFIED'");
    expect(verifiedBranch).toBeGreaterThan(-1);
    const verifiedLabelIndex = s.indexOf('SLSA Provenance — Verified');
    expect(verifiedLabelIndex).toBeGreaterThan(verifiedBranch);
    // No other, unguarded occurrence of the Verified label exists.
    expect(s.indexOf('SLSA Provenance — Verified', verifiedLabelIndex + 1)).toBe(-1);
  });

  it('shows an honest "Evidence Not Available" state when no SLSA evidence exists for the passport', () => {
    const s = source();
    expect(s).toContain('{!slsaEvidence && (');
    expect(s).toContain('Evidence Not Available');
  });

  it('shows a failure state with the real failureReason, and lets the user resubmit', () => {
    const s = source();
    expect(s).toContain("slsaEvidence && slsaEvidence.status === 'FAILED'");
    expect(s).toContain('{slsaEvidence.failureReason ||');
  });

  it('submits to the real, independently-verifying API route rather than setting local state directly', () => {
    const s = source();
    expect(s).toContain('/api/passports/${activePassport.id}/evidence/slsa-provenance');
  });
});
