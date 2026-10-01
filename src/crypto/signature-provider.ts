import crypto from 'node:crypto';
import { requireActiveCryptoAlgorithm } from './algorithm-registry.ts';

export interface SignatureSigner {
  algorithmId: string;
  keyId: string;
  sign(message: Buffer): string;
}

export interface SignatureVerifier {
  algorithmId: string;
  keyId: string;
  verify(message: Buffer, signature: string): boolean;
}

/**
 * Local PEM-backed adapters are one implementation, not the architecture.
 * KMS/HSM/PQ/hybrid providers implement the same interfaces after their
 * algorithm descriptor is marked active in the registry.
 */
export function createNodePemSigner(input: {
  algorithmId: string;
  keyId: string;
  privateKeyPem: string;
}): SignatureSigner {
  requireActiveCryptoAlgorithm(input.algorithmId, 'signature');
  return {
    algorithmId: input.algorithmId,
    keyId: input.keyId,
    sign(message: Buffer) {
      if (input.algorithmId === 'ed25519') return crypto.sign(null, message, input.privateKeyPem).toString('base64url');
      if (input.algorithmId === 'ecdsa-p256-sha256') return crypto.sign('sha256', message, input.privateKeyPem).toString('base64url');
      throw new Error('CRYPTO_SIGNER_IMPLEMENTATION_MISSING');
    },
  };
}

export function createNodePemVerifier(input: {
  algorithmId: string;
  keyId: string;
  publicKeyPem: string;
}): SignatureVerifier {
  requireActiveCryptoAlgorithm(input.algorithmId, 'signature');
  return {
    algorithmId: input.algorithmId,
    keyId: input.keyId,
    verify(message: Buffer, signature: string) {
      const bytes = Buffer.from(signature, 'base64url');
      if (input.algorithmId === 'ed25519') return crypto.verify(null, message, input.publicKeyPem, bytes);
      if (input.algorithmId === 'ecdsa-p256-sha256') return crypto.verify('sha256', message, input.publicKeyPem, bytes);
      return false;
    },
  };
}
