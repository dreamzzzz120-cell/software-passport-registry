import { afterEach, describe, expect, it } from 'vitest';
import { githubHeaders, isRateLimited } from '../src/workers/osv-worker.ts';

// Real production issue (2026-09-10): Free Review acquisition called GitHub with
// no credential, so the worker shared the anonymous 60 requests/hour/IP budget
// from a Railway egress address. The budget was always spent, GitHub answered
// 403, and the worker reported that to the customer as "that repository is
// private" -- for octocat/Hello-World, a public repo. Both halves are covered
// here: the request must carry a token when one is configured, and an exhausted
// budget must be distinguishable from a genuinely inaccessible repository.

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

afterEach(() => { delete process.env.GITHUB_TOKEN; });

describe('githubHeaders', () => {
  it('authenticates the request when GITHUB_TOKEN is configured', () => {
    process.env.GITHUB_TOKEN = 'ghp_example';
    expect(githubHeaders().authorization).toBe('Bearer ghp_example');
  });

  it('omits the header entirely when no token is configured, rather than sending an empty credential', () => {
    expect(githubHeaders()).not.toHaveProperty('authorization');
  });

  it('ignores a whitespace-only token', () => {
    process.env.GITHUB_TOKEN = '   ';
    expect(githubHeaders()).not.toHaveProperty('authorization');
  });

  it('keeps caller-supplied headers and always identifies the worker', () => {
    const result = githubHeaders({ accept: 'application/vnd.github+json' });
    expect(result.accept).toBe('application/vnd.github+json');
    expect(result['user-agent']).toBe('spr-repository-worker/1.0');
  });

  it('does not let a caller override the credential', () => {
    process.env.GITHUB_TOKEN = 'ghp_real';
    expect(githubHeaders({ authorization: 'Bearer spoofed' }).authorization).toBe('Bearer ghp_real');
  });
});

describe('isRateLimited', () => {
  it('treats an exhausted hourly budget as rate limiting, not access denial', () => {
    expect(isRateLimited({ status: 403, headers: headers({ 'x-ratelimit-remaining': '0' }) })).toBe(true);
  });

  it('recognises a secondary-limit 429 carrying retry-after', () => {
    expect(isRateLimited({ status: 429, headers: headers({ 'retry-after': '60' }) })).toBe(true);
  });

  it('leaves a genuine private-repository 403 classified as access denied', () => {
    expect(isRateLimited({ status: 403, headers: headers({ 'x-ratelimit-remaining': '4999' }) })).toBe(false);
  });

  it('does not misclassify a 404 or a successful response', () => {
    expect(isRateLimited({ status: 404, headers: headers({}) })).toBe(false);
    expect(isRateLimited({ status: 200, headers: headers({ 'x-ratelimit-remaining': '0' }) })).toBe(false);
  });
});
