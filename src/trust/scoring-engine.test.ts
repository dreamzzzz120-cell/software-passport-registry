import { describe, expect, it } from 'vitest';
import { calculateCanonicalScores, type CanonicalScoreInput, VERIFIED_COMPLETENESS_THRESHOLD } from './scoring-engine.ts';

const noEvidence: CanonicalScoreInput = { findings: [], evidence: { totalUnits: 0, knownUnits: 0 } };

describe('calculateCanonicalScores', () => {
  it('assigns null scores and null completeness when there is no evidence at all', () => {
    const result = calculateCanonicalScores(noEvidence);
    expect(result.overallScore).toBeNull();
    expect(result.securityScore).toBeNull();
    expect(result.complianceScore).toBeNull();
    expect(result.vendorReputationScore).toBeNull();
    expect(result.confidenceScore).toBeNull();
    expect(result.evidenceCompleteness).toBeNull();
    expect(result.verificationStatus).toBe('unverified');
  });

  it('keeps 0% completeness distinct from no evidence when evidence exists but is all UNKNOWN', () => {
    const result = calculateCanonicalScores({ findings: [], evidence: { totalUnits: 10, knownUnits: 0 } });
    expect(result.evidenceCompleteness).toBe(0);
    expect(result.overallScore).toBeNull();
    expect(result.confidenceScore).toBeNull();
    expect(result.verificationStatus).toBe('unverified');
  });

  it('never publishes a numeric score from sparse partial evidence', () => {
    const result = calculateCanonicalScores({ findings: [], evidence: { totalUnits: 20, knownUnits: 2, freshness: 1 } });
    expect(result.overallScore).toBeNull();
    expect(result.securityScore).toBeNull();
    expect(result.complianceScore).toBeNull();
    expect(result.vendorReputationScore).toBeNull();
    expect(result.evidenceCompleteness).toBe(10);
    expect(result.confidenceScore).toBe(10);
    expect(result.verificationStatus).toBe('partial');
  });

  it('reaches verified status once completeness meets the threshold and then publishes scores', () => {
    const atThreshold = calculateCanonicalScores({ findings: [], evidence: { totalUnits: 100, knownUnits: VERIFIED_COMPLETENESS_THRESHOLD, freshness: 1 } });
    expect(atThreshold.verificationStatus).toBe('verified');
    expect(atThreshold.overallScore).not.toBeNull();
    const justBelow = calculateCanonicalScores({ findings: [], evidence: { totalUnits: 100, knownUnits: VERIFIED_COMPLETENESS_THRESHOLD - 1, freshness: 1 } });
    expect(justBelow.verificationStatus).toBe('partial');
    expect(justBelow.overallScore).toBeNull();
  });

  it('scores security and compliance independently from their own findings', () => {
    const clean = { hasValidSignature: true, hasAuditReport: true };
    const securityOnly = calculateCanonicalScores({
      findings: [{ severity: 'critical', category: 'security', open: true }],
      evidence: { totalUnits: 10, knownUnits: 10, ...clean },
    });
    expect(securityOnly.securityScore).toBeLessThan(100);
    expect(securityOnly.complianceScore).toBe(100);
    expect(securityOnly.securityScore).not.toBe(securityOnly.complianceScore);

    const complianceOnly = calculateCanonicalScores({
      findings: [{ severity: 'critical', category: 'compliance', open: true }],
      evidence: { totalUnits: 10, knownUnits: 10, ...clean },
    });
    expect(complianceOnly.complianceScore).toBeLessThan(100);
    expect(complianceOnly.securityScore).toBe(100);
  });

  it('is deterministic for identical evidence', () => {
    const input: CanonicalScoreInput = {
      findings: [{ severity: 'high', category: 'security', open: true }, { severity: 'medium', category: 'compliance', open: true }],
      evidence: { totalUnits: 100, knownUnits: 80, freshness: 0.9, hasValidSignature: true, hasAuditReport: false },
    };
    const first = calculateCanonicalScores(input);
    const second = calculateCanonicalScores(structuredClone(input));
    expect(second).toEqual(first);
  });

  it('lowers the score when a new open finding is added, and only reports 100 when evidence actually supports it', () => {
    const cleanEvidence = { totalUnits: 100, knownUnits: 100, hasValidSignature: true, hasAuditReport: true };
    const clean = calculateCanonicalScores({ findings: [], evidence: cleanEvidence });
    expect(clean.securityScore).toBe(100);
    expect(clean.verificationStatus).toBe('verified');

    const withFinding = calculateCanonicalScores({
      findings: [{ severity: 'high', category: 'security', open: true }],
      evidence: cleanEvidence,
    });
    expect(withFinding.securityScore).toBeLessThan(clean.securityScore!);

    const resolved = calculateCanonicalScores({
      findings: [{ severity: 'high', category: 'security', open: false }],
      evidence: cleanEvidence,
    });
    expect(resolved.securityScore).toBe(100);
  });

  it('clamps every dimension score to the 0-100 range', () => {
    const result = calculateCanonicalScores({
      findings: Array.from({ length: 10 }, () => ({ severity: 'critical' as const, category: 'security' as const, open: true })),
      evidence: { totalUnits: 100, knownUnits: 100 },
    });
    expect(result.securityScore).toBe(0);
    expect(result.securityScore).toBeGreaterThanOrEqual(0);
  });
});
