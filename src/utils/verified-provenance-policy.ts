/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Policy SPR applies *after* a cryptographic Sigstore verifier succeeds.
 * Cryptographic validity alone is insufficient: the verified statement must
 * be bound to the artifact and signer policy the tenant expected.
 */
export type ProvenancePolicy = {
  expectedArtifactSha256: string;
  expectedCertificateIssuer: string;
  expectedCertificateIdentity: string;
};

export type CryptographicVerification = {
  signatureVerified: boolean;
  certificateIssuer: string | null;
  certificateIdentity: string | null;
  subjectDigestSha256: string | null;
};

export type ProvenancePolicyResult =
  | { outcome: 'VERIFIED'; failureReason: null }
  | { outcome: 'UNKNOWN'; failureReason: 'SIGNATURE_NOT_VERIFIED' | 'MISSING_EXPECTED_POLICY' | 'ISSUER_MISMATCH' | 'IDENTITY_MISMATCH' | 'ARTIFACT_DIGEST_MISMATCH' };

const normalizeDigest = (value: string) => value.trim().toLowerCase().replace(/^sha256:/, '');

export function enforceVerifiedProvenancePolicy(
  verification: CryptographicVerification,
  policy: ProvenancePolicy,
): ProvenancePolicyResult {
  if (!verification.signatureVerified) return { outcome: 'UNKNOWN', failureReason: 'SIGNATURE_NOT_VERIFIED' };

  const expectedDigest = normalizeDigest(policy.expectedArtifactSha256);
  const expectedIssuer = policy.expectedCertificateIssuer.trim();
  const expectedIdentity = policy.expectedCertificateIdentity.trim();
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !expectedIssuer || !expectedIdentity) {
    return { outcome: 'UNKNOWN', failureReason: 'MISSING_EXPECTED_POLICY' };
  }
  if (verification.certificateIssuer !== expectedIssuer) return { outcome: 'UNKNOWN', failureReason: 'ISSUER_MISMATCH' };
  if (verification.certificateIdentity !== expectedIdentity) return { outcome: 'UNKNOWN', failureReason: 'IDENTITY_MISMATCH' };
  if (normalizeDigest(verification.subjectDigestSha256 ?? '') !== expectedDigest) {
    return { outcome: 'UNKNOWN', failureReason: 'ARTIFACT_DIGEST_MISMATCH' };
  }
  return { outcome: 'VERIFIED', failureReason: null };
}
