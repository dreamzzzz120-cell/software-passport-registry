import { describe, expect, it } from 'vitest';
import { evaluateVendorRisk } from '../src/agents/vendor-risk-agent.ts';

const base = {
  passport: { id: 'p1', name: 'Example Vendor' },
  findings: [],
  evidence: [{ id: 'e1', provider: 'OSV', observedAt: '2026-09-12T00:00:00.000Z', verificationMethod: 'api', status: 'observed', limitation: null }],
  latestObservationAt: '2026-09-12T00:00:00.000Z',
  completeness: 1,
  evaluatedAt: Date.parse('2026-09-12T12:00:00.000Z'),
};

describe('Vendor Risk Agent', () => {
  it('returns UNKNOWN when there is no observed evidence', () => {
    const result = evaluateVendorRisk({ ...base, evidence: [] });
    expect(result.status).toBe('UNKNOWN');
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.triggers.some((trigger) => trigger.type === 'NO_OBSERVED_EVIDENCE')).toBe(true);
  });

  it('raises HIGH for an open critical finding', () => {
    const result = evaluateVendorRisk({ ...base, findings: [{ id: 'f1', severity: 'critical', status: 'open', title: 'Critical issue', updatedAt: '2026-09-12T00:00:00.000Z' }] });
    expect(result.status).toBe('HIGH');
    expect(result.findings.criticalOrHigh).toBe(1);
    expect(result.triggers[0].evidenceIds).toEqual(['f1']);
  });

  it('raises MEDIUM for stale evidence without inventing a finding', () => {
    const result = evaluateVendorRisk({ ...base, latestObservationAt: '2026-07-01T00:00:00.000Z', evaluatedAt: Date.parse('2026-09-12T00:00:00.000Z') });
    expect(result.status).toBe('MEDIUM');
    expect(result.evidence.stale).toBe(true);
    expect(result.findings.open).toBe(0);
  });

  it('is deterministic for identical input', () => {
    const first = evaluateVendorRisk(base);
    const second = evaluateVendorRisk(base);
    expect(second).toEqual(first);
  });
});
