import { describe, expect, it } from 'vitest';
import { explainChange, explainFinding, toPlainEnglish, type CanonicalReport } from '../src/trust/plain-english-report.ts';

const finding = (overrides: Partial<CanonicalReport['findings'][number]> = {}): CanonicalReport['findings'][number] => ({
  id: 'finding_1', control_id: 'mfa', title: 'MFA enforcement', severity: 'high', status: 'OPEN',
  description: 'MFA is not enforced.', remediation: 'Enable MFA.', updated_at: new Date().toISOString(), resolved_at: null, ...overrides,
});

const report = (overrides: Partial<CanonicalReport> = {}): CanonicalReport => ({
  passport: { id: 'p1', name: 'Test Software' },
  risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' },
  evidenceQuality: { completenessBasisPoints: 0, unknownDimensions: 0, latestObservationAt: null },
  findings: [], evidence: [], generatedAt: new Date().toISOString(), ...overrides,
});

describe('explainFinding never claims more than the underlying data supports', () => {
  it('maps OPEN to Needs Review, never to a clean pass', () => {
    const explained = explainFinding(finding({ status: 'OPEN' }));
    expect(explained.status).toBe('Needs Review');
    expect(explained.whyItMatters).not.toContain('is resolved');
  });

  it('maps UNKNOWN to Unknown and explains the gap honestly, never implying failure', () => {
    const explained = explainFinding(finding({ status: 'UNKNOWN' }));
    expect(explained.status).toBe('Unknown');
    expect(explained.whatWeDontKnow).toBeTruthy();
    expect(explained.whyItMatters).toContain('does not currently have enough');
  });

  it('maps RESOLVED to Resolved with no outstanding action', () => {
    const explained = explainFinding(finding({ status: 'RESOLVED' }));
    expect(explained.status).toBe('Resolved');
    expect(explained.whatToDoNext).toContain('No action needed');
  });

  it('preserves the real technical fields underneath the plain-English layer', () => {
    const explained = explainFinding(finding({ control_id: 'mfa-enforcement', severity: 'critical' }));
    expect(explained.technical.controlId).toBe('mfa-enforcement');
    expect(explained.technical.severity).toBe('critical');
  });
});

describe('toPlainEnglish never fabricates a conclusion the score/findings do not support', () => {
  it('reports "no checks have produced evidence yet" for an empty findings list, not a false-positive all-clear', () => {
    const result = toPlainEnglish(report({ findings: [] }));
    expect(result.headline).toContain('No checks');
  });

  it('never claims a guarantee of security, even when nothing needs attention', () => {
    const result = toPlainEnglish(report({ findings: [finding({ status: 'RESOLVED' })] }));
    expect(result.headline).toBe('Nothing currently needs attention');
    expect(result.situation).toContain('should be read as a guarantee');
  });

  it('surfaces UNKNOWN findings under "needs attention" alongside OPEN ones, never silently drops them', () => {
    const result = toPlainEnglish(report({ findings: [finding({ id: 'f1', status: 'UNKNOWN', title: 'Vulnerability scan' })] }));
    expect(result.whatNeedsAttention[0]).toContain('Vulnerability scan');
    expect(result.whatNeedsAttention[0]).toContain('not enough evidence');
  });

  it('explains a null score honestly instead of implying a real number', () => {
    const result = toPlainEnglish(report({ risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' } }));
    expect(result.scoreExplanation.value).toBeNull();
    expect(result.scoreExplanation.explanation).toContain('does not yet have enough');
  });

  it('always includes the "not a guarantee" disclaimer on the score, regardless of how high it is', () => {
    const result = toPlainEnglish(report({ risk: { overall: 98, security: 98, compliance: 98, verificationStatus: 'verified' } }));
    expect(result.scoreExplanation.disclaimer).toContain('not a guarantee');
  });
});

describe('explainChange reuses the real before/after values from compareCanonicalObservations, never recalculates', () => {
  it('reflects a real score decrease', () => {
    const result = explainChange({ type: 'score_decreased', before: 90, after: 70 });
    expect(result.before).toContain('90');
    expect(result.now).toContain('70');
  });

  it('explains score_became_ineligible without implying a bad score, since it is a different state entirely', () => {
    const result = explainChange({ type: 'score_became_ineligible', before: 80, after: null });
    expect(result.whatItMeans).toContain('not the same as a bad score');
  });

  it('falls back honestly for an unrecognized change type instead of guessing', () => {
    const result = explainChange({ type: 'some_future_change_type', before: 'x', after: 'y' });
    expect(result.whyItChanged).toBe('New evidence changed this value.');
  });
});
