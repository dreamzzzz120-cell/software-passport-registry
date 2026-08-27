import { describe, expect, it } from 'vitest';
import { deriveReportRiskFields, type ReportPassportRow } from '../src/routes/trust-loop.ts';

// Regression coverage for the trust_report_snapshots integrity bug: a report
// is a permanent historical record and must never claim a measurement was
// made when it wasn't. Number(passport.overall_score ?? 0) used to turn an
// unverified passport's null score into a fabricated, immutable "0".

function passport(overrides: Partial<ReportPassportRow> = {}): ReportPassportRow {
  return { overall_score: null, security_score: null, compliance_score: null, verification_status: null, confidence_score: null, evidence_completeness: null, ...overrides };
}

describe('deriveReportRiskFields', () => {
  it('keeps an unverified passport score as null, never 0, in a generated report', () => {
    const fields = deriveReportRiskFields(passport({ verification_status: 'unverified' }));
    expect(fields.canonicalScore).toBeNull();
    expect(fields.canonicalScore).not.toBe(0);
    expect(fields.verificationStatus).toBe('unverified');
    expect(fields.completenessBasisPoints).toBe(0);
  });

  it('defaults to unverified when verification_status was never set (legacy row)', () => {
    const fields = deriveReportRiskFields(passport({ verification_status: null }));
    expect(fields.verificationStatus).toBe('unverified');
  });

  it('preserves the actual score, partial status, and real confidence/completeness for a partially verified passport', () => {
    const fields = deriveReportRiskFields(passport({
      overall_score: 74,
      verification_status: 'partial',
      confidence_score: 38,
      evidence_completeness: 42,
    }));
    expect(fields.canonicalScore).toBe(74);
    expect(fields.verificationStatus).toBe('partial');
    expect(fields.confidenceBasisPoints).toBe(3800);
    expect(fields.completenessBasisPoints).toBe(4200);
  });

  it('preserves the actual score, verified status, and real confidence/completeness for a fully verified passport', () => {
    const fields = deriveReportRiskFields(passport({
      overall_score: 96,
      verification_status: 'verified',
      confidence_score: 88,
      evidence_completeness: 95,
    }));
    expect(fields.canonicalScore).toBe(96);
    expect(fields.verificationStatus).toBe('verified');
    expect(fields.confidenceBasisPoints).toBe(8800);
    expect(fields.completenessBasisPoints).toBe(9500);
  });

  it('never conflates a real score of 0 with an unverified passport', () => {
    // A passport can legitimately score 0 (all evidence resolved, all
    // critical findings open) -- that is a real measurement and must be
    // kept distinct from "no measurement exists" (null).
    const fields = deriveReportRiskFields(passport({ overall_score: 0, verification_status: 'verified', confidence_score: 90, evidence_completeness: 100 }));
    expect(fields.canonicalScore).toBe(0);
    expect(fields.verificationStatus).toBe('verified');
  });
});
