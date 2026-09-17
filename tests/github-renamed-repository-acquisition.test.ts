import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGitHubApi } from '../src/workers/osv-worker.ts';

// GitHub answers /repos/:owner/:name with 301 -> /repositories/<id> once a
// repository has been renamed or transferred. Before this helper the workers
// fetched with redirect:'error', which surfaced as an opaque "fetch failed",
// was classified as transient, and burned every retry on a deterministic
// condition (observed in production: jonschlinkert/is-odd, 3 attempts, 193s).

const headers = { accept: 'application/vnd.github+json' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(sequence: Array<{ status: number; location?: string; body?: string }>) {
  const calls: Array<{ url: string; redirect: string | undefined }> = [];
  globalThis.fetch = vi.fn(async (input: any, init: any) => {
    const next = sequence.shift();
    if (!next) throw new Error('unexpected extra fetch');
    calls.push({ url: String(input), redirect: init?.redirect });
    return new Response(next.body ?? '', { status: next.status, headers: next.location ? { location: next.location } : {} });
  }) as any;
  return calls;
}

describe('GitHub API acquisition follows exactly one canonical same-origin redirect', () => {
  it('follows a 301 to /repositories/<id> on api.github.com and returns the canonical metadata', async () => {
    const calls = mockFetch([
      { status: 301, location: 'https://api.github.com/repositories/31246939' },
      { status: 200, body: '{"name":"is-odd","owner":{"login":"i-voted-for-trump"}}' },
    ]);
    const response = await fetchGitHubApi('https://api.github.com/repos/jonschlinkert/is-odd', { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'is-odd', owner: { login: 'i-voted-for-trump' } });
    expect(calls.map((c) => c.url)).toEqual(['https://api.github.com/repos/jonschlinkert/is-odd', 'https://api.github.com/repositories/31246939']);
    // The first hop must not auto-follow; the second must never follow again.
    expect(calls.map((c) => c.redirect)).toEqual(['manual', 'error']);
  });

  it('refuses a redirect that leaves the GitHub API origin instead of following it', async () => {
    const calls = mockFetch([{ status: 302, location: 'https://evil.example/repos/x' }]);
    await expect(fetchGitHubApi('https://api.github.com/repos/a/b', { headers })).rejects.toThrow('OUTBOUND_URL_BLOCKED');
    expect(calls).toHaveLength(1);
  });

  it('passes non-redirect responses (404, 200) through untouched with a single request', async () => {
    const calls = mockFetch([{ status: 404, body: '{"message":"Not Found"}' }]);
    const response = await fetchGitHubApi('https://api.github.com/repos/sindresorhus/is-odd', { headers });
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('never accepts a non-GitHub URL as the starting point', async () => {
    const calls = mockFetch([]);
    await expect(fetchGitHubApi('https://codeload.github.com/repos/a/b', { headers })).rejects.toThrow('OUTBOUND_URL_BLOCKED');
    expect(calls).toHaveLength(0);
  });
});

describe('both scan workers use the canonical (post-redirect) repository name for the archive', () => {
  it('osv-worker and security-scanner-worker derive canonicalOwner/canonicalName from metadata and use them for codeload', () => {
    const fs = require('node:fs');
    for (const file of ['src/workers/osv-worker.ts', 'src/workers/security-scanner-worker.ts']) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, file).toContain('const canonicalOwner = ');
      expect(source, file).toContain('const canonicalName = ');
      expect(source, file).toMatch(/(codeload\.github\.com|GITHUB_CODELOAD_ORIGIN)[^\n]*encodeURIComponent\(canonicalOwner\)[^\n]*encodeURIComponent\(canonicalName\)/);
      expect(source, file).not.toMatch(/fetch\([^\n]*repoApi[^\n]*redirect: 'error'/);
    }
  });
});
