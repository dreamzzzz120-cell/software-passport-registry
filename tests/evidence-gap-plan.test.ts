import { describe, expect, it } from 'vitest';
import { buildEvidenceGapPlan, evidenceGapPlanText } from '../src/trust/evidence-gap-plan';
import { explainFinding, toPlainEnglish, type CanonicalReport } from '../src/trust/plain-english-report';

const finding = (status = 'UNKNOWN'): CanonicalReport['findings'][number] => ({ id: 'f1', control_id: 'mfa', title: 'MFA enforcement', severity: 'high', status,
  description: 'The source token cannot read this check.', remediation: '', updated_at: '2026-10-09T00:00:00Z', resolved_at: null });
const evidence: CanonicalReport['evidence'][number] = { id: 'e1', provider: 'microsoft-365', control_id: 'mfa', observed_at: '2026-10-08T00:00:00Z', verification_method: 'provider-api', status: 'UNKNOWN' };
const report = (overrides: Partial<CanonicalReport> = {}): CanonicalReport => ({ passport: { id: 'p1', name: 'Client application' }, reportHash: 'hash-1',
  risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' },
  evidenceQuality: { completenessBasisPoints: 0, unknownDimensions: 0, latestObservationAt: null },
  findings: [], evidence: [], generatedAt: '2026-10-09T00:00:00Z', ...overrides });

describe('evidence gaps become proposed work without changing evidence or authority', () => {
  it('preserves source linkage and supplies evidence, question, recipient and closure criteria', () => {
    const input = report({ findings: [finding()], evidence: [evidence] });
    const before = JSON.stringify(input);
    const plan = buildEvidenceGapPlan(input);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ status: 'UNKNOWN', owner: null, findingId: 'f1', controlId: 'mfa', evidence: [{ id: 'e1', provider: 'microsoft-365', observedAt: evidence.observed_at, status: 'UNKNOWN' }] });
    expect(plan.actions[0].question).toContain('MFA enforcement (mfa)');
    expect(plan.actions[0].requestedEvidence).toContain('dated source record');
    expect(plan.actions[0].completionCriteria).toContain('new report');
    expect(plan.reportHash).toBe('hash-1');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('does not claim resolved coverage when aggregate unknowns remain', () => {
    const result = toPlainEnglish(report({ findings: [finding('RESOLVED')], evidenceQuality: { completenessBasisPoints: 9000, unknownDimensions: 2, latestObservationAt: null } }));
    expect(result.headline).toBe('Resolved findings; evidence gaps still need review');
    expect(result.reviewPlan.actions[0].controlId).toBeNull();
    expect(result.reviewPlan.actions[0].reason).toContain('may overlap');
    expect(result.reviewPlan.actions[0].nextStep).toContain('Do not invent');
  });
  it('retains a limitation even when its source record is verified and deduplicates the same report limitation', () => {
    const result = buildEvidenceGapPlan(report({ evidence: [{ ...evidence, status: 'VERIFIED', limitation: 'Only one account could be observed.' }], limitations: [{ evidenceId: 'e1', limitation: 'Only one account could be observed.' }] }));
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ status: 'UNKNOWN', basis: 'limitation' });
    expect(result.actions[0].evidence[0].status).toBe('VERIFIED');
  });
  it('surfaces unknown source records even without findings', () => {
    const result = toPlainEnglish(report({ evidence: [evidence], findings: [finding('RESOLVED')] }));
    expect(result.reviewPlan.actions[0].basis).toBe('evidence');
    expect(result.headline).not.toBe('Nothing currently needs attention');
  });
  it('unrecognized finding status stays unknown in explanations and the plan', () => {
    const explained = explainFinding(finding('COLLECTOR_ERROR'));
    expect(explained.status).toBe('Unknown');
    expect(explained.whyItMatters).not.toContain('is resolved');
    expect(explained.whatToDoNext).not.toContain('No action');
    expect(explained.howSerious.explanation).toContain('remain unknown');
    expect(toPlainEnglish(report({ findings: [finding('COLLECTOR_ERROR')] })).headline).toBe('1 item needs attention');
  });
  it('does not invent tasks for resolved checks backed by passing records', () => {
    expect(buildEvidenceGapPlan(report({ findings: [finding('RESOLVED')], evidence: [{ ...evidence, status: 'PASS' }] })).actions).toEqual([]);
  });
  it('distinguishes open corrective work from unknown collection work', () => {
    const action = buildEvidenceGapPlan(report({ findings: [{ ...finding('OPEN'), remediation: 'Enforce MFA then recollect.' }] })).actions[0];
    expect(action.status).toBe('NEEDS_REVIEW');
    expect(action.nextStep).toBe('Enforce MFA then recollect.');
    expect(action.completionCriteria).toContain('independently verified');
  });
  it('turns empty results into a coverage question without inventing control names', () => {
    const action = buildEvidenceGapPlan(report()).actions[0];
    expect(action.basis).toBe('coverage');
    expect(action.findingId).toBeNull();
    expect(action.controlId).toBeNull();
    expect(action.owner).toBeNull();
  });
  it('includes real repository unknowns and keeps scanner scope boundaries', () => {
    const result = toPlainEnglish(report({ repositoryScan: { sbomComponentCount: 4, evidence: [], findings: [{ id: 's1', title: 'Component check unavailable', severity: 'high', status: 'UNKNOWN', description: 'Package version not supplied.' }] } }));
    expect(result.reviewPlan.actions[0]).toMatchObject({ findingId: 's1', status: 'UNKNOWN' });
    expect(result.situation).toContain('does not establish deployment safety');
  });
  it('invalid evidence linkage never creates phantom source records', () => {
    const plan = buildEvidenceGapPlan(report({ findings: [{ ...finding(), control_id: 'other', evidence_ids: '{invalid' }], evidence: [{ ...evidence, status: 'PASS' }] }));
    expect(plan.actions[0].evidence).toEqual([]);
  });
  it('explicit evidence references exclude other records with the same control', () => {
    const plan = buildEvidenceGapPlan(report({ findings: [{ ...finding(), evidence_ids: ['e1'] }], evidence: [evidence, { ...evidence, id: 'another-account' }] }));
    expect(plan.actions[0].evidence.map(e => e.id)).toEqual(['e1']);
  });
  it('JSON evidence references preserve cross-control linkage without copying unrelated records', () => {
    const plan = buildEvidenceGapPlan(report({ findings: [{ ...finding(), control_id: 'other', evidence_ids: '["e1"]' }], evidence: [{ ...evidence, status: 'PASS' }] }));
    expect(plan.actions[0].evidence.map(e => e.id)).toEqual(['e1']);
  });
  it('exports the real plan and visible unassigned ownership, never fabricated completion', () => {
    const text = evidenceGapPlanText(buildEvidenceGapPlan(report({ findings: [finding()], evidence: [evidence] })));
    expect(text).toContain('hash-1');
    expect(text).toContain('Owner: Unassigned');
    expect(text).toContain('e1 | microsoft-365 | UNKNOWN');
    expect(text).toContain('not assigned or completed work');
  });
});
