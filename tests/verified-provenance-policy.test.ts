/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { enforceVerifiedProvenancePolicy } from '../src/utils/verified-provenance-policy.ts';

const digest = 'a'.repeat(64);
const policy = {
  expectedArtifactSha256: digest,
  expectedCertificateIssuer: 'https://token.actions.githubusercontent.com',
  expectedCertificateIdentity: 'https://github.com/acme/widget/.github/workflows/release.yml@refs/heads/main',
};
const verified = {
  signatureVerified: true,
  certificateIssuer: policy.expectedCertificateIssuer,
  certificateIdentity: policy.expectedCertificateIdentity,
  subjectDigestSha256: digest,
};

describe('verified provenance policy', () => {
  it('requires cryptographic signature verification', () => {
    expect(enforceVerifiedProvenancePolicy({ ...verified, signatureVerified: false }, policy)).toEqual({
      outcome: 'UNKNOWN', failureReason: 'SIGNATURE_NOT_VERIFIED',
    });
  });

  it('fails closed on issuer mismatch', () => {
    expect(enforceVerifiedProvenancePolicy({ ...verified, certificateIssuer: 'https://evil.example' }, policy).outcome).toBe('UNKNOWN');
  });

  it('fails closed on signer identity mismatch', () => {
    expect(enforceVerifiedProvenancePolicy({ ...verified, certificateIdentity: 'https://github.com/evil/repo' }, policy).outcome).toBe('UNKNOWN');
  });

  it('fails closed on artifact digest mismatch', () => {
    expect(enforceVerifiedProvenancePolicy({ ...verified, subjectDigestSha256: 'b'.repeat(64) }, policy)).toEqual({
      outcome: 'UNKNOWN', failureReason: 'ARTIFACT_DIGEST_MISMATCH',
    });
  });

  it('rejects incomplete expected policy', () => {
    expect(enforceVerifiedProvenancePolicy(verified, { ...policy, expectedCertificateIdentity: '' }).outcome).toBe('UNKNOWN');
  });

  it('returns VERIFIED only when signature, identity, issuer and artifact all match', () => {
    expect(enforceVerifiedProvenancePolicy(verified, policy)).toEqual({ outcome: 'VERIFIED', failureReason: null });
  });
});
