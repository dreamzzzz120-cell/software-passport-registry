import crypto from 'node:crypto';

export const MAX_EVIDENCE_VERIFICATION_BYTES = 10 * 1024 * 1024;

export function verifyEvidenceIntegrity(rawContent: string, storedHash: string) {
  const byteLength = Buffer.byteLength(rawContent, 'utf8');
  if (byteLength > MAX_EVIDENCE_VERIFICATION_BYTES) {
    return {
      outcome: 'rejected' as const,
      verified: false,
      digestAlgorithm: 'SHA-256' as const,
      payloadEncoding: 'UTF-8' as const,
      byteLength,
      failureReason: 'EVIDENCE_PAYLOAD_TOO_LARGE'
    };
  }

  const normalizedHash = storedHash.trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    return {
      outcome: 'failed' as const,
      verified: false,
      digestAlgorithm: 'SHA-256' as const,
      payloadEncoding: 'UTF-8' as const,
      byteLength,
      failureReason: 'INVALID_STORED_SHA256'
    };
  }

  const computedHash = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');
  const matches = crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(normalizedHash, 'hex')
  );
  return {
    outcome: matches ? 'verified' as const : 'failed' as const,
    verified: matches,
    digestAlgorithm: 'SHA-256' as const,
    payloadEncoding: 'UTF-8' as const,
    byteLength,
    storedHash: normalizedHash,
    computedHash,
    failureReason: matches ? null : 'SHA256_MISMATCH'
  };
}
