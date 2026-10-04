import { describe, expect, it } from 'vitest';
import { scoreLicensing } from '../src/free-review/scoring.ts';

describe('free review licence scope wording', () => {
  it('does not claim unevaluable components are all CI workflow references', () => {
    const result = scoreLicensing({
      securityEngineCompleted: true,
      repositoryEngineCompleted: true,
      findings: [],
      sbomComponentCount: 58,
      licenceUnevaluatedComponentCount: 58,
      evidence: [],
    });
    expect(result.status).toBe('not_observed');
    if (result.status === 'not_observed') {
      expect(result.reason).toContain('unresolved dependency declarations');
      expect(result.reason).not.toContain('Every SBOM component is a CI workflow action reference');
    }
  });
});
