import { describe, expect, it } from 'vitest';
import { assessOsvSeverity } from '../src/security/osv-severity.ts';

describe('OSV severity normalization', () => {
  it.each([
    [9.8, 'Critical'], [7.5, 'High'], [5.0, 'Medium'], [2.1, 'Low'],
  ])('maps CVSS score %s to %s', (score, expected) => {
    expect(assessOsvSeverity({ severity: [{ type: 'CVSS_V3', score }] }).severity).toBe(expected);
  });
  it('recognizes and preserves CVSS vectors without inventing a score', () => {
    const result = assessOsvSeverity({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] });
    expect(result.severity).toBe('Unknown');
    expect(result.cvssVectors[0]).toContain('CVSS:3.1/');
  });
  it('uses an available OSV source severity', () => {
    expect(assessOsvSeverity({ database_specific: { severity: 'HIGH' }, severity: [{ score: 2.0 }] }).severity).toBe('High');
  });
  it('keeps malformed and missing data Unknown', () => {
    expect(assessOsvSeverity({ severity: [{ score: 'not-a-score' }] }).severity).toBe('Unknown');
    expect(assessOsvSeverity({}).severity).toBe('Unknown');
  });
  it('uses the highest score from multiple severity records', () => {
    expect(assessOsvSeverity({ severity: [{ score: 4.0 }, { score: 8.1 }] }).severity).toBe('High');
  });
});
