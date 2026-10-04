import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGitLsRemoteHead, parseGitLsRemoteRef } from '../src/workers/osv-worker.ts';

describe('GitHub public repository rate-limit fallback', () => {
  it('parses git ls-remote HEAD into default branch and immutable SHA', () => {
    const out = 'ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n';
    expect(parseGitLsRemoteHead(out)).toEqual({
      defaultBranch: 'main',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    });
  });

  it('prefers peeled annotated-tag SHA, then branch/tag refs', () => {
    const out = [
      '1111111111111111111111111111111111111111\trefs/tags/v1.0.0',
      '2222222222222222222222222222222222222222\trefs/tags/v1.0.0^{}',
      '3333333333333333333333333333333333333333\trefs/heads/v1.0.0',
    ].join('\n');
    expect(parseGitLsRemoteRef(out, 'v1.0.0')).toBe('2222222222222222222222222222222222222222');
  });

  it('rejects unsafe ref syntax before spawning git', () => {
    expect(() => parseGitLsRemoteRef('', '--upload-pack=evil')).toThrow('REPOSITORY_REF_NOT_FOUND');
    expect(() => parseGitLsRemoteRef('', '../secret')).toThrow('REPOSITORY_REF_NOT_FOUND');
    expect(() => parseGitLsRemoteRef('', 'refs/heads/main~1')).toThrow('REPOSITORY_REF_NOT_FOUND');
  });

  it('wires both repository workers to the git fallback and ships git in the runtime image', () => {
    const osv = readFileSync(resolve(process.cwd(), 'src/workers/osv-worker.ts'), 'utf8');
    const security = readFileSync(resolve(process.cwd(), 'src/workers/security-scanner-worker.ts'), 'utf8');
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

    expect(osv).toContain("resolvePublicGitHubRefViaGit");
    expect(osv).toContain("github_api_rate_limit_fallback");
    expect(security).toContain("resolvePublicGitHubRefViaGit");
    expect(security).toContain("github_api_rate_limit_fallback");
    expect(dockerfile).toContain('ca-certificates curl git unzip tar');
  });
});
