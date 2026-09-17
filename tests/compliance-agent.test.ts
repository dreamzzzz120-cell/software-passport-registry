import { describe, expect, it } from 'vitest';
import { evaluateCompliance } from '../src/agents/compliance-agent.ts';

describe('compliance agent', () => {
  it('returns PASS only for fresh passing evidence', () => {
    const evaluatedAt = Date.parse('2026-09-17T00:00:00Z');
    const result = evaluateCompliance({ passport: { id: 'p1', name: 'Example' }, evaluatedAt, evidence: [{ id: 'e1', controlId: 'AC-1', status: 'pass', observedAt: '2026-09-16T00:00:00Z', verificationMethod: 'test', limitation: null }], findings: [] });
    expect(result.overall).toBe('PASS');
    expect(result.confidence).toBe('EVIDENCE_BACKED');
  });
  it('keeps missing evidence UNKNOWN instead of inferring compliance', () => {
    const result = evaluateCompliance({ passport: { id: 'p1', name: 'Example' }, evaluatedAt: Date.now(), evidence: [], findings: [{ id: 'f1', controlId: 'AC-2', severity: 'high', status: 'open', title: 'Missing control evidence' }] });
    expect(result.overall).toBe('FAIL');
    expect(result.controls[0].findingIds).toEqual(['f1']);
  });
});
