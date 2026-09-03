import { describe, expect, it } from 'vitest';
import { guardAIClaims } from '../../src/security/ai-claim-guard.ts';

const base = {
  evidenceIds: ['ev-1', 'finding-1'],
  vulnerabilityIds: ['CVE-2026-1234'],
  vendors: ['Acme'],
  dependencies: ['lodash'],
  controlIds: ['AC-2'],
  scores: { overall: 82, security: 74 },
  assessedFrameworks: [],
  verifiedCertifications: [],
};

describe('AI claim guard', () => {
  it('accepts evidence-grounded text with an explicit unknown', () => {
    const result = guardAIClaims(
      'Acme is observed in the supplied evidence. The security score is 74/100. Compliance status is unknown.',
      base,
      { unknowns: ['Compliance certification was not established.'], provenancePresent: true },
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects unsupported compliance claims', () => {
    const result = guardAIClaims('The software is SOC 2 compliant.', base, { provenancePresent: true });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('UNSUPPORTED_COMPLIANCE_STATUS');
  });

  it('rejects framework claims when the framework was not assessed', () => {
    const result = guardAIClaims('This system conforms to NIST SP 800-218.', base, { provenancePresent: true });
    expect(result.violations).toContain('UNASSESSED_FRAMEWORK_REFERENCE');
  });

  it('rejects certification claims without verified certification evidence', () => {
    const result = guardAIClaims('The vendor is ISO 27001 certified.', { ...base, vendors: ['Acme'] }, { provenancePresent: true });
    expect(result.violations).toContain('UNSUPPORTED_CERTIFICATION');
  });

  it('rejects unsupported vulnerability identifiers', () => {
    const result = guardAIClaims('Finding CVE-2026-9999 requires attention; status unknown.', base, { provenancePresent: true });
    expect(result.violations).toContain('UNSUPPORTED_VULNERABILITY');
  });

  it('rejects unsupported scores', () => {
    const result = guardAIClaims('The security score is 99/100. Compliance status is unknown.', base, { provenancePresent: true });
    expect(result.violations).toContain('UNSUPPORTED_SCORE');
  });

  it('rejects absolute certainty and speculative language', () => {
    const result = guardAIClaims('This configuration guarantees security and probably eliminates risk; unknowns remain.', base, { provenancePresent: true });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('RECOMMENDATION_AS_FACT');
    expect(result.violations).toContain('SPECULATIVE_INFERENCE');
  });

  it('requires unknown disclosure', () => {
    const result = guardAIClaims('Acme was observed in the supplied evidence.', base, { provenancePresent: true });
    expect(result.violations).toContain('MISSING_UNKNOWN_DISCLOSURE');
  });

  it('fails closed when provenance is absent', () => {
    const result = guardAIClaims('Acme was observed in the supplied evidence. Compliance status is unknown.', base, { provenancePresent: false });
    expect(result.violations).toContain('MISSING_PROVENANCE');
  });
});
