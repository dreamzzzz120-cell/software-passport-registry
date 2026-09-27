import { describe, expect, it } from 'vitest';
import { compareRegisteredDigest } from './registered-digest.ts';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const passport = { id: 'pass_1', fileHash: a };

describe('registered digest comparison', () => {
  it('reports equality of stored and supplied digest without claiming identity', () => {
    const result = compareRegisteredDigest(passport, `sha256:${a}`);
    expect(result.state).toBe('REGISTERED_DIGEST_MATCH');
    expect(result.identityVerified).toBe(false);
    expect(result.trustDecision).toBe('NOT_EVALUATED');
    expect(result.evidenceIds).toEqual([]);
  });
  it('reports a different registered digest without asserting counterfeit software', () => {
    const result = compareRegisteredDigest(passport, b);
    expect(result.state).toBe('REGISTERED_DIGEST_DIFFERENT');
    expect(result.identityVerified).toBe(false);
  });
  it('returns UNKNOWN for malformed or absent comparable digests', () => {
    expect(compareRegisteredDigest(passport, 'abc').state).toBe('UNKNOWN');
    expect(compareRegisteredDigest({ id: 'pass_1', fileHash: '' }, a).state).toBe('UNKNOWN');
  });
});
