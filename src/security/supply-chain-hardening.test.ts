import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

function verifySha256(content: string, expected: string): boolean {
  return crypto.createHash('sha256').update(content).digest('hex') === expected.toLowerCase();
}

function dependencyPolicy(vulnerabilities: number, lockfilePresent: boolean): 'allow' | 'block' {
  if (!lockfilePresent) return 'block';
  if (!Number.isSafeInteger(vulnerabilities) || vulnerabilities < 0) return 'block';
  return vulnerabilities === 0 ? 'allow' : 'block';
}

describe('supply-chain security contract', () => {
  it('requires a lockfile and blocks known vulnerable dependency sets', () => {
    expect(dependencyPolicy(0, true)).toBe('allow');
    expect(dependencyPolicy(1, true)).toBe('block');
    expect(dependencyPolicy(0, false)).toBe('block');
  });

  it('fails closed for invalid vulnerability counts', () => {
    expect(dependencyPolicy(-1, true)).toBe('block');
    expect(dependencyPolicy(Number.NaN, true)).toBe('block');
    expect(dependencyPolicy(Number.POSITIVE_INFINITY, true)).toBe('block');
  });

  it('detects artifact tampering with SHA-256', () => {
    const artifact = 'trusted-build-artifact';
    const digest = crypto.createHash('sha256').update(artifact).digest('hex');
    expect(verifySha256(artifact, digest)).toBe(true);
    expect(verifySha256('tampered-artifact', digest)).toBe(false);
  });

  it('requires exact hash equality rather than prefix matching', () => {
    const artifact = 'build';
    const digest = crypto.createHash('sha256').update(artifact).digest('hex');
    expect(verifySha256(artifact, digest.slice(0, 20))).toBe(false);
  });
});
