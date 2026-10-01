import crypto from 'node:crypto';

export type CryptoPurpose = 'hash' | 'signature' | 'key-establishment' | 'certificate';
export type CryptoFamily = 'classical' | 'post-quantum' | 'hybrid';
export type CryptoImplementationState = 'active' | 'planned' | 'deprecated';

export interface CryptoAlgorithmDescriptor {
  id: string;
  purpose: CryptoPurpose;
  family: CryptoFamily;
  implementationState: CryptoImplementationState;
  nodeName?: string;
}

/**
 * Canonical algorithm identifiers are versioned data, not implicit code defaults.
 * PQ algorithms are deliberately registered as planned until a production
 * implementation is actually available and verified.
 */
export const CRYPTO_ALGORITHMS: Readonly<Record<string, CryptoAlgorithmDescriptor>> = Object.freeze({
  'sha2-256': { id: 'sha2-256', purpose: 'hash', family: 'classical', implementationState: 'active', nodeName: 'sha256' },
  'sha2-512': { id: 'sha2-512', purpose: 'hash', family: 'classical', implementationState: 'active', nodeName: 'sha512' },
  'ed25519': { id: 'ed25519', purpose: 'signature', family: 'classical', implementationState: 'active' },
  'ecdsa-p256-sha256': { id: 'ecdsa-p256-sha256', purpose: 'signature', family: 'classical', implementationState: 'active' },
  'ml-kem-768': { id: 'ml-kem-768', purpose: 'key-establishment', family: 'post-quantum', implementationState: 'planned' },
  'ml-dsa-65': { id: 'ml-dsa-65', purpose: 'signature', family: 'post-quantum', implementationState: 'planned' },
  'slh-dsa-sha2-128s': { id: 'slh-dsa-sha2-128s', purpose: 'signature', family: 'post-quantum', implementationState: 'planned' },
  'hybrid-ed25519-ml-dsa-65': { id: 'hybrid-ed25519-ml-dsa-65', purpose: 'signature', family: 'hybrid', implementationState: 'planned' },
});

export function getCryptoAlgorithm(id: string): CryptoAlgorithmDescriptor {
  const algorithm = CRYPTO_ALGORITHMS[id];
  if (!algorithm) throw new Error('UNSUPPORTED_CRYPTO_ALGORITHM');
  return algorithm;
}

export function requireActiveCryptoAlgorithm(id: string, purpose?: CryptoPurpose): CryptoAlgorithmDescriptor {
  const algorithm = getCryptoAlgorithm(id);
  if (purpose && algorithm.purpose !== purpose) throw new Error('CRYPTO_ALGORITHM_PURPOSE_MISMATCH');
  if (algorithm.implementationState !== 'active') throw new Error('CRYPTO_ALGORITHM_NOT_ACTIVE');
  return algorithm;
}

export function digestBytes(algorithmId: string, data: crypto.BinaryLike): string {
  const algorithm = requireActiveCryptoAlgorithm(algorithmId, 'hash');
  if (!algorithm.nodeName) throw new Error('CRYPTO_ALGORITHM_IMPLEMENTATION_MISSING');
  return crypto.createHash(algorithm.nodeName).update(data).digest('hex');
}

export function digestUtf8(algorithmId: string, value: string): string {
  return digestBytes(algorithmId, Buffer.from(value, 'utf8'));
}

export function encodeDigest(algorithmId: string, digest: string): string {
  requireActiveCryptoAlgorithm(algorithmId, 'hash');
  if (!/^[a-f0-9]+$/i.test(digest)) throw new Error('INVALID_DIGEST_ENCODING');
  return `${algorithmId}:${digest.toLowerCase()}`;
}

export function parseDigest(encoded: string): { algorithmId: string; digest: string } {
  const separator = encoded.indexOf(':');
  if (separator <= 0) throw new Error('INVALID_DIGEST_FORMAT');
  const algorithmId = encoded.slice(0, separator);
  const digest = encoded.slice(separator + 1);
  const algorithm = requireActiveCryptoAlgorithm(algorithmId, 'hash');
  if (!algorithm.nodeName || !/^[a-f0-9]+$/i.test(digest)) throw new Error('INVALID_DIGEST_FORMAT');
  const expectedHexLength = crypto.createHash(algorithm.nodeName).digest().length * 2;
  if (digest.length !== expectedHexLength) throw new Error('INVALID_DIGEST_LENGTH');
  return { algorithmId, digest: digest.toLowerCase() };
}
