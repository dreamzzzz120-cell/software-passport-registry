import { describe, it, expect } from 'vitest';
import { toPlainEnglish, explainFinding, formatEvidenceRequests, type CanonicalReport } from '../src/trust/plain-english-report.ts';
const record: CanonicalReport = {
  passport: { id: 'p', name: 'Software' },
  risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' },
  evidenceQuality: { completenessBasisPoints: 0, unknownDimensions: 0, latestObservationAt: null },
  findings: [], evidence: [], generatedAt: '2026-10-09',
};
const finding = (status: string) => ({ id: status, control_id: 'mfa', title: 'Sign-in review', severity: 'unclassified', status, description: 'No source available', remediation: '', updated_at: '2026-10-09', resolved_at: null });
describe('missing evidence follow-up', () => {
  it('retains unfamiliar outcomes as unknown without calling them resolved or harmless', () => {
    const f = explainFinding(finding('PENDING'));
    expect(f.status).toBe('Unknown');
    expect(f.whyItMatters).not.toContain('is resolved');
    expect(f.whatToDoNext).not.toContain('No action needed');
    expect(f.howSerious.explanation).toContain('not been classified');
    const r = toPlainEnglish({ ...record, findings: [finding('PENDING')] });
    expect(r.headline).toBe('1 item needs attention');
    expect(r.whatNeedsAttention[0]).toContain('not enough evidence');
  });
  it('requests evidence only for unknown findings and leaves ownership unassigned', () => {
    const r = toPlainEnglish({ ...record, findings: [finding('OPEN'), finding('UNKNOWN'), finding('RESOLVED')] });
    expect(r.evidenceRequests?.length).toBe(1);
    expect(r.evidenceRequests?.[0].reference).toBe('UNKNOWN');
    expect(r.evidenceRequests?.[0].owner).toBeNull();
    expect(r.evidenceRequests?.[0].dueAt).toBeNull();
    expect(r.evidenceRequests?.[0].closureRule).toContain('alone does not resolve');
  });
  it('keeps aggregate coverage separate without inventing individual checks', () => {
    const r = toPlainEnglish({ ...record, evidenceQuality: { ...record.evidenceQuality, unknownDimensions: 4 } });
    expect(r.evidenceRequests?.length).toBe(1);
    expect(r.evidenceRequests?.[0].question).toContain('4 recorded unknown dimensions');
    expect(r.findings.length).toBe(0);
    expect(r.scoreExplanation.value).toBeNull();
  });
  it('does not invent follow-up tasks for empty coverage', () => {
    expect(toPlainEnglish(record).evidenceRequests?.length).toBe(0);
  });
  it('includes repository unknowns without treating them as deployment evidence', () => {
    const r = toPlainEnglish({ ...record, repositoryScan: { sbomComponentCount: 0, evidence: [], findings: [{ id: 'scan', title: 'Scan incomplete', severity: 'HIGH', status: 'unknown', description: 'No response', engineId: 'scanner' }] } });
    expect(r.evidenceRequests?.[0].reference).toBe('scan');
    expect(r.evidenceRequests?.[0].question).toContain('scanner');
    expect(r.scoreExplanation.value).toBeNull();
  });
  it('copies the question, reference, evidence requirements and closure rule', () => {
    const r = toPlainEnglish({ ...record, findings: [finding('UNKNOWN')] });
    const text = formatEvidenceRequests(r.evidenceRequests ?? []);
    expect(text).toContain('Reference: UNKNOWN');
    expect(text).toContain('Owner: Unassigned');
    expect(text).toContain('Deadline: Unassigned');
    expect(text).toContain('observation date');
    expect(text).toContain('Do not include credentials');
    expect(text).toContain('To close:');
  });
});
