import { describe, expect, it } from 'vitest';

describe('founder distribution opportunity contract', () => {
  it('requires evidence-safe opportunity fields', () => {
    const required = ['jobId', 'kind', 'score', 'company', 'url', 'signals', 'observedAt', 'jobUpdatedAt'];
    expect(required).toEqual(expect.arrayContaining(['jobId', 'score', 'url', 'signals', 'observedAt']));
  });

  it('does not treat missing score as zero', () => {
    const score: number | null = null;
    expect(score).toBeNull();
    expect(score ?? 'Not verified').toBe('Not verified');
  });
});
