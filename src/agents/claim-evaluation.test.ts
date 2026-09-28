import { describe, expect, it } from 'vitest';
import { evaluateUnmappedClaim } from './claim-evaluation.ts';

describe('unmapped claim evaluation', () => {
  it('does not verify a claim with no evidence', () => {
    expect(evaluateUnmappedClaim(0, 0).status).toBe('UNVERIFIED');
  });
  it('does not infer proof from zero open findings', () => {
    const result = evaluateUnmappedClaim(8, 0);
    expect(result.status).toBe('UNVERIFIED');
    expect(result.reason).toMatch(/Zero open findings/);
  });
  it('does not infer a specific contradiction from unrelated findings', () => {
    expect(evaluateUnmappedClaim(8, 2).status).toBe('UNVERIFIED');
  });
});
