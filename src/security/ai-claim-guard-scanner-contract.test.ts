import { describe, expect, it } from 'vitest';
import { guardAIClaims } from './ai-claim-guard.ts';

describe('customer-facing scanner AI claim boundary', () => {
  it('fails closed on unsupported compliance claims', () => {
    const result = guardAIClaims('SOC 2 compliant; unknowns remain.', { evidenceIds: ['ev-1'], assessedFrameworks: [], verifiedCertifications: [] }, { unknowns: ['Not assessed'], provenancePresent: true });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('UNSUPPORTED_COMPLIANCE_STATUS');
  });
});
