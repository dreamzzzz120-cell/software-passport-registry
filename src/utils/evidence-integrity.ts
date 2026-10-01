import crypto from 'node:crypto';
import { digestUtf8, parseDigest } from '../crypto/algorithm-registry.ts';

export const MAX_EVIDENCE_VERIFICATION_BYTES = 10 * 1024 * 1024;

function normalizeStoredDigest(storedHash: string): { algorithmId: string; digest: string } {
  const trimmed = storedHash.trim().toLowerCase();
  // Legacy rows stored bare SHA-256 hex or sha256:<hex>. Keep them readable
  // during migration, but normalize every verification through the registry.
  if (/^[a-f0-9]{64}$/.test(trimmed)) return { algorithmId: 'sha2-256', digest: trimmed };
  if (/^sha256:[a-f0-9]{64}$/.test(trimmed)) return { algorithmId: 'sha2-256', digest: trimmed.slice(7) };
  return parseDigest(trimmed);
}

export function verifyEvidenceIntegrity(rawContent: string, storedHash: string) {
  const byteLength = Buffer.byteLength(rawContent, 'utf8');
  if (byteLength > MAX_EVIDENCE_VERIFICATION_BYTES) {
    return {
      outcome: 'rejected' as const,
      verified: false,
      digestAlgorithm: null,
      payloadEncoding: 'UTF-8' as const,
      byteLength,
      failureReason: 'EVIDENCE_PAYLOAD_TOO_LARGE'
    };
  }

  let parsed: { algorithmId: string; digest: string };
  try {
    parsed = normalizeStoredDigest(storedHash);
  } catch {
    return {
      outcome: 'failed' as const,
      verified: false,
      digestAlgorithm: null,
      payloadEncoding: 'UTF-8' as const,
      byteLength,
      failureReason: 'INVALID_STORED_DIGEST'
    };
  }

  const computedHash = digestUtf8(parsed.algorithmId, rawContent);
  const storedBytes = Buffer.from(parsed.digest, 'hex');
  const computedBytes = Buffer.from(computedHash, 'hex');
  const matches = storedBytes.length === computedBytes.length && crypto.timingSafeEqual(computedBytes, storedBytes);
  return {
    outcome: matches ? 'verified' as const : 'failed' as const,
    verified: matches,
    digestAlgorithm: parsed.algorithmId,
    payloadEncoding: 'UTF-8' as const,
    byteLength,
    storedHash: parsed.digest,
    computedHash,
    failureReason: matches ? null : 'DIGEST_MISMATCH'
  };
}
