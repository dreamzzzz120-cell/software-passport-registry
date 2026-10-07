import { describe, expect, it } from 'vitest';
import { buildResearchShadowMission } from '../src/lib/q-legion-shadow.ts';
import { decideMission } from '../src/agents/q-legion.ts';

describe('Q-LEGION live shadow swarm', () => {
  it('builds competing strategies from observed distribution evidence without granting authority', () => {
    const built = buildResearchShadowMission('dist_1', {
      url: 'https://example.com',
      company: 'Example MSP',
      score: 82,
      httpObserved: true,
      observedAt: '2026-10-07T12:00:00Z',
      publicRoleEmails: ['sales@example.com'],
      signals: { msp: true, cybersecurity: true, compliance: true, multiClient: true },
    }, '2026-10-07T12:01:00Z');
    expect(built.input.strategies).toHaveLength(3);
    expect(built.advisoryStrategyId).not.toBeNull();
    expect(built.input.authorityGrant).toBeNull();
    expect(decideMission(built.input).status).toBe('HOLD');
  });

  it('lets a deterministic red-team blocker suppress weak prospects', () => {
    const built = buildResearchShadowMission('dist_2', {
      url: 'https://example.org',
      score: 30,
      httpObserved: true,
      publicRoleEmails: ['info@example.org'],
      signals: { msp: false },
    });
    expect(built.input.redTeamFindings.some((finding) => finding.severity === 'BLOCKER')).toBe(true);
    expect(built.advisoryStrategyId).toBeNull();
  });

  it('preserves contactability as UNKNOWN when no public role email was observed', () => {
    const built = buildResearchShadowMission('dist_3', {
      url: 'https://example.net',
      score: 70,
      httpObserved: true,
      publicRoleEmails: [],
      signals: { msp: true, multiClient: true },
    });
    expect(built.input.evidence.find((item) => item.id.endsWith(':public-contact'))?.state).toBe('UNKNOWN');
    expect(built.input.redTeamFindings.some((finding) => finding.id === 'no_public_role_email')).toBe(true);
  });
});
