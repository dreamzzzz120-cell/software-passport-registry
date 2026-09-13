import { describe, expect, it } from 'vitest';
import { evaluateCompliance } from '../src/agents/compliance-agent.ts';

const base = {
  passport: { id: 'p1', name: 'Example' },
  evaluatedAt: Date.parse('2026-09-12T00:00:00.000Z'),
};

describe('compliance agent', () => {
  it('returns UNKNOWN when there is no observed control evidence', () => {
    const result = evaluateCompliance({ ...base, evidence: [], findings: [] });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.controls).toHaveLength(0);
  });

  it('returns PASS only for current observed passing evidence', () => {
    const result = evaluateCompliance({
      ...base,
      evidence: [{ id: 'e1', controlId: 'security.scan', status: 'verified', observedAt: '2026-09-11T00:00:00.000Z', verificationMethod: 'osv', limitation: null }],
      findings: [],
    });
    expect(result.overall).toBe('PASS');
    expect(result.controls[0]).toMatchObject({ controlId: 'security.scan', decision: 'PASS', evidenceIds: ['e1'] });
  });

  it('returns FAIL when an unresolved finding contradicts a control', () => {
    const result = evaluateCompliance({
      ...base,
      evidence: [{ id: 'e1', controlId: 'security.scan', status: 'verified', observedAt: '2026-09-11T00:00:00.000Z', verificationMethod: 'osv', limitation: null }],
      findings: [{ id: 'f1', controlId: 'security.scan', severity: 'high', status: 'open', title: 'Unresolved vulnerability' }],
    });
    expect(result.overall).toBe('FAIL');
    expect(result.controls[0].findingIds).toEqual(['f1']);
  });

  it('keeps stale evidence UNKNOWN instead of treating it as compliant', () => {
    const result = evaluateCompliance({
      ...base,
      staleAfterDays: 30,
      evidence: [{ id: 'e1', controlId: 'security.scan', status: 'verified', observedAt: '2026-07-01T00:00:00.000Z', verificationMethod: 'osv', limitation: null }],
      findings: [],
    });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.controls[0].decision).toBe('UNKNOWN');
  });

  it('is deterministic and does not accept unsupported statuses as PASS', () => {
    const input = {
      ...base,
      evidence: [{ id: 'e1', controlId: 'identity', status: 'maybe', observedAt: '2026-09-11T00:00:00.000Z', verificationMethod: 'unknown', limitation: null }],
      findings: [],
    };
    const first = evaluateCompliance(input);
    const second = evaluateCompliance(input);
    expect(first).toEqual(second);
    expect(first.controls[0].decision).toBe('UNKNOWN');
  });
});
