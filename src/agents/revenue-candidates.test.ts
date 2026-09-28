import { describe, expect, it } from 'vitest';
import { findEvidenceBackedReviewCandidates, type FindingRecord, type EvidenceRecord } from './revenue-candidates.ts';

const now = new Date('2026-09-26T08:00:00Z');
const finding: FindingRecord = { id: 'f1', passportId: 'p1', clientId: 'c1', title: 'Patch gap',
  severity: 'high', status: 'OPEN', evidenceIds: '["e1"]', updatedAt: now.toISOString() };
const evidence: EvidenceRecord = { id: 'e1', passportId: 'p1', status: 'FAIL',
  observedAt: now.toISOString(), verificationMethod: 'provider_api', evidenceHash: 'a'.repeat(64) };

describe('revenue review candidate evidence gate', () => {
  it('produces a review candidate with lineage and no invented price', () => {
    expect(findEvidenceBackedReviewCandidates([finding], [evidence], now)).toEqual([
      expect.objectContaining({ id: 'finding-review:f1', evidenceIds: ['e1'],
        estimatedValue: null, requiresHumanApproval: true })
    ]);
  });
  it('does not cross-link evidence from another passport', () => {
    expect(findEvidenceBackedReviewCandidates([finding], [{ ...evidence, passportId: 'p2' }], now)).toEqual([]);
  });
  it('excludes unlinked, unknown, undated, stale and untraceable evidence', () => {
    for (const altered of [
      { ...evidence, id: 'other' }, { ...evidence, status: 'UNKNOWN' },
      { ...evidence, observedAt: null }, { ...evidence, observedAt: '2026-07-01T00:00:00Z' },
      { ...evidence, verificationMethod: '' }, { ...evidence, evidenceHash: '' }
    ]) expect(findEvidenceBackedReviewCandidates([finding], [altered], now)).toEqual([]);
  });
  it('excludes resolved and low severity findings', () => {
    expect(findEvidenceBackedReviewCandidates([{ ...finding, status: 'RESOLVED' }], [evidence], now)).toEqual([]);
    expect(findEvidenceBackedReviewCandidates([{ ...finding, severity: 'low' }], [evidence], now)).toEqual([]);
  });
  it('does not accept a future observation', () => {
    expect(findEvidenceBackedReviewCandidates([finding], [{ ...evidence, observedAt: '2026-09-27T00:00:00Z' }], now)).toEqual([]);
  });
});
