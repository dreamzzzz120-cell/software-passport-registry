import { describe, expect, it } from 'vitest';
import { classifyQuestionTopic, matchQuestionToEvidence, type QuestionnaireFinding } from '../src/trust/questionnaire-matcher.ts';

const finding = (overrides: Partial<QuestionnaireFinding> = {}): QuestionnaireFinding => ({
  id: 'finding_1', controlId: 'mfa-enforcement', title: 'MFA enforcement', description: 'Multi-factor authentication is enforced for all accounts.',
  status: 'RESOLVED', severity: 'medium', evidenceIds: ['evidence_1'], updatedAt: new Date().toISOString(), ...overrides,
});

describe('classifyQuestionTopic', () => {
  it('classifies common real questionnaire phrasings', () => {
    expect(classifyQuestionTopic('Do you enforce MFA for all employee accounts?')).toBe('mfa');
    expect(classifyQuestionTopic('Is data encrypted at rest and in transit?')).toBe('encryption');
    expect(classifyQuestionTopic('Do you perform annual penetration testing?')).toBe('vulnerability');
    expect(classifyQuestionTopic('What is your RTO/RPO for disaster recovery?')).toBe('backup');
    expect(classifyQuestionTopic('Are you SOC 2 Type II certified?')).toBe('certification');
  });

  it('returns null for a question matching no known topic', () => {
    expect(classifyQuestionTopic('What color is your company logo?')).toBeNull();
  });
});

describe('matchQuestionToEvidence', () => {
  it('never fabricates an answer when no finding matches the question\'s topic', () => {
    const result = matchQuestionToEvidence('Do you enforce MFA?', [finding({ controlId: 'backup-policy', title: 'Backup policy', description: 'Daily backups configured.' })]);
    expect(result.status).toBe('UNKNOWN');
    expect(result.draftAnswer).toBeNull();
    expect(result.confidenceBasisPoints).toBe(0);
  });

  it('returns UNKNOWN for a question with no classifiable topic at all, regardless of available findings', () => {
    const result = matchQuestionToEvidence('What color is your logo?', [finding()]);
    expect(result.status).toBe('UNKNOWN');
  });

  it('drafts a positive answer with cited evidence when the matching finding is resolved', () => {
    const result = matchQuestionToEvidence('Do you require MFA?', [finding()]);
    expect(result.status).toBe('ANSWERED');
    expect(result.draftAnswer).toContain('satisfied');
    expect(result.evidenceIds).toEqual(['evidence_1']);
    expect(result.confidenceBasisPoints).toBeGreaterThan(0);
  });

  it('flags NEEDS_REVIEW instead of a clean pass when the matching finding is still open', () => {
    const result = matchQuestionToEvidence('Do you require MFA?', [finding({ status: 'OPEN' })]);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.draftAnswer).toContain('requires review');
    expect(result.draftAnswer).not.toContain('is satisfied');
  });

  it('prioritizes an open finding over a resolved one when both match the same topic (never hides a real gap)', () => {
    const result = matchQuestionToEvidence('Do you require MFA?', [finding({ id: 'f1', status: 'RESOLVED' }), finding({ id: 'f2', status: 'OPEN', title: 'MFA gap on legacy system' })]);
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  // Real bug found during live verification: a topic-matched finding whose
  // OWN status is UNKNOWN (neither OPEN nor RESOLVED -- a real, common
  // state, e.g. a GitHub control the connected token lacks permission to
  // check) fell through to the ANSWERED branch with zero resolved
  // controls, drafting "this requirement is satisfied" backed by nothing.
  it('never claims satisfaction when every matching finding is itself UNKNOWN', () => {
    const result = matchQuestionToEvidence('Do you have vulnerability alerts enabled?', [finding({ controlId: 'github-vulnerability-alerts', title: 'Repository dependency vulnerability alerts', status: 'UNKNOWN' })]);
    expect(result.status).toBe('UNKNOWN');
    expect(result.draftAnswer).toBeNull();
    expect(result.confidenceBasisPoints).toBe(0);
  });

  it('decays confidence for stale evidence', () => {
    const fresh = matchQuestionToEvidence('Do you require MFA?', [finding({ updatedAt: new Date().toISOString() })]);
    const stale = matchQuestionToEvidence('Do you require MFA?', [finding({ updatedAt: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString() })]);
    expect(stale.confidenceBasisPoints).toBeLessThan(fresh.confidenceBasisPoints);
  });
});
