/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { verifySlsaProvenance } from '../src/utils/slsa-verification.ts';

function sha256(text: string) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const validStatement = JSON.stringify({
  _type: 'https://in-toto.io/Statement/v1',
  predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{ name: 'my-artifact', digest: { sha256: 'a'.repeat(64) } }],
  predicate: { builder: { id: 'https://github.com/actions/runner' }, buildType: 'https://actions.github.io/buildtypes/workflow/v1' },
});

// This is the load-bearing invariant behind the whole feature: SPR must
// never display "SLSA Level 4 -- Verified" (or any Verified state) unless a
// real, well-formed, hash-consistent provenance statement was actually
// submitted. Every case here that isn't the single valid one must FAIL --
// there is no path that lets a fabricated or malformed statement pass.
describe('verifySlsaProvenance', () => {
  it('verifies a well-formed, hash-consistent in-toto/SLSA provenance statement', () => {
    const result = verifySlsaProvenance(validStatement, sha256(validStatement));
    expect(result.outcome).toBe('VERIFIED');
    expect(result.failureReason).toBeNull();
    expect(result.builderId).toBe('https://github.com/actions/runner');
    expect(result.predicateType).toBe('https://slsa.dev/provenance/v1');
    expect(result.subjectDigestSha256).toBe('a'.repeat(64));
  });

  it('never reports VERIFIED when the content does not match the declared hash', () => {
    const result = verifySlsaProvenance(validStatement, sha256('tampered content'));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toContain('HASH_MISMATCH');
  });

  it('never reports VERIFIED when the declared hash is fabricated garbage', () => {
    const result = verifySlsaProvenance(validStatement, 'not-a-real-hash');
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toContain('HASH_MISMATCH');
  });

  it('rejects malformed JSON even if the hash happens to match', () => {
    const garbage = '{not valid json';
    const result = verifySlsaProvenance(garbage, sha256(garbage));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toBe('MALFORMED_JSON');
  });

  it('rejects a statement that is not a recognized in-toto Statement type', () => {
    const statement = JSON.stringify({ ...JSON.parse(validStatement), _type: 'https://example.com/NotInToto' });
    const result = verifySlsaProvenance(statement, sha256(statement));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toBe('UNRECOGNIZED_STATEMENT_TYPE');
  });

  it('rejects a predicateType that is not a recognized SLSA provenance predicate', () => {
    const statement = JSON.stringify({ ...JSON.parse(validStatement), predicateType: 'https://example.com/not-slsa' });
    const result = verifySlsaProvenance(statement, sha256(statement));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toBe('UNRECOGNIZED_PREDICATE_TYPE');
  });

  it('rejects a statement with no builder id -- a fabricated statement cannot claim an empty builder', () => {
    const parsed = JSON.parse(validStatement);
    delete parsed.predicate.builder;
    const statement = JSON.stringify(parsed);
    const result = verifySlsaProvenance(statement, sha256(statement));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toBe('MISSING_BUILDER_ID');
  });

  it('rejects a statement with no subject digest', () => {
    const parsed = JSON.parse(validStatement);
    parsed.subject = [{ name: 'my-artifact' }];
    const statement = JSON.stringify(parsed);
    const result = verifySlsaProvenance(statement, sha256(statement));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).toBe('MISSING_SUBJECT_DIGEST');
  });

  it('never invents a SLSA level -- the result carries only fields it actually verified', () => {
    const result = verifySlsaProvenance(validStatement, sha256(validStatement));
    expect(result).not.toHaveProperty('slsaLevel');
    expect(result).not.toHaveProperty('level');
  });
});
