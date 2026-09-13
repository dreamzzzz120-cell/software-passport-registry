import { describe, expect, it } from 'vitest';
import { normalizeCandidate } from '../src/agents/public-repository-team-v2.ts';

describe('public repository agent team', () => {
  it('normalizes observable public repository metadata', () => {
    const result = normalizeCandidate({
      owner: { login: 'octocat' }, name: 'hello-world', stargazers_count: 123,
      language: 'TypeScript', default_branch: 'main', pushed_at: '2026-09-13T00:00:00Z',
      license: { spdx_id: 'MIT' }, archived: false, fork: false,
    });
    expect(result).toMatchObject({ owner: 'octocat', repository: 'hello-world', stars: 123, language: 'TypeScript', licenseSpdx: 'MIT', defaultBranch: 'main', archived: false, fork: false });
    expect(result?.url).toBe('https://github.com/octocat/hello-world');
  });

  it('rejects malformed identities before queueing work', () => {
    expect(normalizeCandidate({ owner: { login: 'bad owner' }, name: 'repo' })).toBeNull();
    expect(normalizeCandidate({ owner: { login: 'owner' }, name: '../repo' })).toBeNull();
  });

  it('quarantines archived and forked repositories as non-publishable input', () => {
    expect(normalizeCandidate({ owner: { login: 'owner' }, name: 'repo', archived: true })?.archived).toBe(true);
    expect(normalizeCandidate({ owner: { login: 'owner' }, name: 'repo', fork: true })?.fork).toBe(true);
  });
});
