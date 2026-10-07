import { describe, expect, it } from 'vitest';
import { assessStrategies, buildMissionReceipt, decideMission, type MissionInput } from '../src/agents/q-legion.ts';

function mission(overrides: Partial<MissionInput> = {}): MissionInput {
  return {
    missionId: 'mission-1',
    objective: 'Acquire one verified MSP customer',
    evidence: [{ id: 'e1', state: 'KNOWN', observedAt: '2026-10-07T10:00:00Z', source: 'observed' }],
    strategies: [{
      id: 's1',
      label: 'Proof-first outreach',
      hypothesis: 'Observed proof will improve qualified replies',
      probability: 0.72,
      expectedValueCents: 14900,
      estimatedCostCents: 900,
      reversibility: 'REVERSIBLE',
      requiredEvidenceIds: ['e1'],
    }],
    redTeamFindings: [],
    judgeReviews: [{ strategyId: 's1', accepted: true, rationale: 'Grounded and reversible', evidenceIds: ['e1'] }],
    authorityGrant: { issuer: 'constellation', level: 'CONSTELLATION', scope: ['mission:mission-1'], expiresAt: null },
    now: '2026-10-07T11:00:00Z',
    ...overrides,
  };
}

describe('Q-LEGION governed mission core', () => {
  it('selects an eligible strategy deterministically', () => {
    const result = decideMission(mission());
    expect(result.status).toBe('READY_FOR_EXECUTION');
    expect(result.selectedStrategyId).toBe('s1');
  });

  it('preserves UNKNOWN instead of manufacturing readiness without evidence', () => {
    const result = decideMission(mission({ evidence: [] }));
    expect(result.status).toBe('UNKNOWN');
    expect(result.selectedStrategyId).toBeNull();
  });

  it('fails closed when required evidence is stale or unknown', () => {
    const input = mission({ evidence: [{ id: 'e1', state: 'STALE', observedAt: '2026-01-01T00:00:00Z', source: 'old observation' }] });
    const [assessment] = assessStrategies(input);
    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons.join('|')).toContain('EVIDENCE_NOT_ACTIONABLE:e1');
  });

  it('lets a red-team blocker veto an otherwise valid strategy', () => {
    const input = mission({ redTeamFindings: [{ id: 'r1', severity: 'BLOCKER', statement: 'Evidence contradicts the pitch', evidenceIds: ['e1'] }] });
    const result = decideMission(input);
    expect(result.status).toBe('HOLD');
    expect(result.assessments[0].reasons).toContain('RED_TEAM_BLOCKER:r1');
  });

  it('requires human authority for irreversible action', () => {
    const input = mission({
      strategies: [{ ...mission().strategies[0], reversibility: 'IRREVERSIBLE' }],
      authorityGrant: { issuer: 'constellation', level: 'CONSTELLATION', scope: ['mission:mission-1'], expiresAt: null },
    });
    expect(decideMission(input).status).toBe('HOLD');

    const approved = mission({
      strategies: [{ ...mission().strategies[0], reversibility: 'IRREVERSIBLE' }],
      authorityGrant: { issuer: 'human', level: 'HUMAN', scope: ['mission:mission-1'], expiresAt: null },
    });
    expect(decideMission(approved).status).toBe('READY_FOR_EXECUTION');
  });

  it('does not allow an agent authority level or missing scope to authorize execution', () => {
    const input = mission({ authorityGrant: null });
    expect(decideMission(input).status).toBe('HOLD');

    const wrongScope = mission({ authorityGrant: { issuer: 'constellation', level: 'CONSTELLATION', scope: ['mission:other'], expiresAt: null } });
    expect(decideMission(wrongScope).status).toBe('HOLD');
  });

  it('treats probabilities as advisory and clamps malformed confidence', () => {
    const input = mission({
      strategies: [
        { ...mission().strategies[0], id: 's-high', probability: 5 },
        { ...mission().strategies[0], id: 's-unknown', probability: null },
      ],
      judgeReviews: [
        { strategyId: 's-high', accepted: true, rationale: 'ok', evidenceIds: ['e1'] },
        { strategyId: 's-unknown', accepted: true, rationale: 'ok', evidenceIds: ['e1'] },
      ],
    });
    const assessments = assessStrategies(input);
    expect(assessments.find((a) => a.strategyId === 's-high')?.advisoryProbability).toBe(1);
    expect(assessments.find((a) => a.strategyId === 's-unknown')?.advisoryProbability).toBeNull();
  });

  it('emits a compact mission receipt with provenance ids', () => {
    const input = mission();
    const decision = decideMission(input);
    const receipt = buildMissionReceipt(input, decision);
    expect(receipt.schemaVersion).toBe('spr-q-legion-mission-v1');
    expect(receipt.evidenceIds).toEqual(['e1']);
    expect(receipt.judgeStrategyIds).toEqual(['s1']);
  });
});
