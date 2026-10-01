import crypto from 'node:crypto';
import { digestUtf8, requireActiveCryptoAlgorithm } from './algorithm-registry.ts';

const FORBIDDEN_PORTABLE_CONCLUSIONS = new Set([
  'trustScore', 'safe', 'approved', 'compliant', 'authorized', 'trusted'
]);

export type EvidenceState = 'UNKNOWN' | 'UNVERIFIED' | 'VERIFIED' | 'CONFLICT' | 'EXPIRED' | 'FAILED';

export interface EvidenceReference {
  evidenceId: string;
  artifactDigest?: string;
  state: EvidenceState;
}

export interface CanonicalEvidencePackage {
  packageId: string;
  schemaVersion: 'spr-evidence-package/v1';
  issuer: string;
  tenantId: string;
  subject: string;
  createdAt: string;
  expiresAt?: string;
  observations: readonly unknown[];
  evidence: readonly EvidenceReference[];
  payloadDigestAlgorithm: string;
  payloadDigest: string;
  signatureAlgorithm: string;
  signingKeyId: string;
  signature: string;
}

function assertNoPortableConclusions(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPortableConclusions(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PORTABLE_CONCLUSIONS.has(key)) {
      throw new Error(`PORTABLE_CONCLUSION_FORBIDDEN:${path}.${key}`);
    }
    assertNoPortableConclusions(child, `${path}.${key}`);
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_CANONICAL_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  throw new Error('NON_CANONICAL_VALUE');
}

export interface EvidencePackageUnsigned {
  packageId: string;
  issuer: string;
  tenantId: string;
  subject: string;
  createdAt: string;
  expiresAt?: string;
  observations: readonly unknown[];
  evidence: readonly EvidenceReference[];
}

export function createEvidencePackage(
  input: EvidencePackageUnsigned,
  signing: { algorithmId: string; keyId: string; privateKeyPem: string; digestAlgorithmId?: string }
): CanonicalEvidencePackage {
  assertNoPortableConclusions(input);
  const created = Date.parse(input.createdAt);
  if (!Number.isFinite(created)) throw new Error('INVALID_CREATED_AT');
  if (input.expiresAt && Date.parse(input.expiresAt) <= created) throw new Error('INVALID_EXPIRATION');
  requireActiveCryptoAlgorithm(signing.algorithmId, 'signature');
  const digestAlgorithm = signing.digestAlgorithmId ?? 'sha2-256';
  requireActiveCryptoAlgorithm(digestAlgorithm, 'hash');

  const payload = {
    schemaVersion: 'spr-evidence-package/v1' as const,
    packageId: input.packageId,
    issuer: input.issuer,
    tenantId: input.tenantId,
    subject: input.subject,
    createdAt: input.createdAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    observations: input.observations,
    evidence: input.evidence,
  };
  const canonical = canonicalJson(payload);
  const payloadDigest = digestUtf8(digestAlgorithm, canonical);
  const signature = signPayload(signing.algorithmId, canonical, signing.privateKeyPem);
  return {
    ...payload,
    payloadDigestAlgorithm: digestAlgorithm,
    payloadDigest,
    signatureAlgorithm: signing.algorithmId,
    signingKeyId: signing.keyId,
    signature,
  };
}

function signPayload(algorithmId: string, canonical: string, privateKeyPem: string): string {
  if (algorithmId === 'ed25519') {
    return crypto.sign(null, Buffer.from(canonical), privateKeyPem).toString('base64url');
  }
  if (algorithmId === 'ecdsa-p256-sha256') {
    return crypto.sign('sha256', Buffer.from(canonical), privateKeyPem).toString('base64url');
  }
  throw new Error('CRYPTO_ALGORITHM_IMPLEMENTATION_MISSING');
}

export function verifyEvidencePackage(
  pkg: CanonicalEvidencePackage,
  publicKeyPem: string,
  nowMs = Date.now()
): EvidenceState {
  try {
    assertNoPortableConclusions(pkg);
    requireActiveCryptoAlgorithm(pkg.payloadDigestAlgorithm, 'hash');
    requireActiveCryptoAlgorithm(pkg.signatureAlgorithm, 'signature');
    if (pkg.expiresAt && Date.parse(pkg.expiresAt) <= nowMs) return 'EXPIRED';
    const payload = {
      schemaVersion: pkg.schemaVersion,
      packageId: pkg.packageId,
      issuer: pkg.issuer,
      tenantId: pkg.tenantId,
      subject: pkg.subject,
      createdAt: pkg.createdAt,
      ...(pkg.expiresAt ? { expiresAt: pkg.expiresAt } : {}),
      observations: pkg.observations,
      evidence: pkg.evidence,
    };
    const canonical = canonicalJson(payload);
    if (digestUtf8(pkg.payloadDigestAlgorithm, canonical) !== pkg.payloadDigest) return 'FAILED';
    const sig = Buffer.from(pkg.signature, 'base64url');
    const valid = pkg.signatureAlgorithm === 'ed25519'
      ? crypto.verify(null, Buffer.from(canonical), publicKeyPem, sig)
      : pkg.signatureAlgorithm === 'ecdsa-p256-sha256'
        ? crypto.verify('sha256', Buffer.from(canonical), publicKeyPem, sig)
        : false;
    return valid ? 'VERIFIED' : 'FAILED';
  } catch {
    return 'FAILED';
  }
}
