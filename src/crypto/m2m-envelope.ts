import crypto from 'node:crypto';
import { canonicalJson } from './evidence-package.ts';
import { digestUtf8, requireActiveCryptoAlgorithm } from './algorithm-registry.ts';
import { evaluateKeyForNewSignature, type CryptoKeyRecord } from './key-policy.ts';

export interface M2MReplayStore {
  /**
   * Atomically records issuer+tenant+nonce until expiresAt.
   * Returns false when the nonce already exists.
   */
  consumeNonce(input: { issuer: string; tenantId: string; nonce: string; envelopeId: string; expiresAt: string }): Promise<boolean>;
}

export interface M2MEnvelopeUnsigned {
  envelopeId: string;
  schemaVersion: 'spr-m2m-envelope/v1';
  issuer: string;
  recipient: string;
  subject: string;
  tenantId: string;
  evidenceReferences: readonly string[];
  payloadDigestAlgorithm: string;
  payloadDigest: string;
  createdAt: string;
  expiresAt: string;
  nonce: string;
  sequence?: number;
  signingAlgorithm: string;
  signingKeyId: string;
}

export interface M2MEnvelope extends M2MEnvelopeUnsigned {
  signature: string;
}

export type EnvelopeVerificationFailure =
  | 'MALFORMED'
  | 'INVALID_SCHEMA'
  | 'INVALID_SIGNATURE'
  | 'WRONG_TENANT'
  | 'UNAUTHORIZED_ISSUER'
  | 'WRONG_RECIPIENT'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'DUPLICATE_NONCE'
  | 'UNEXPECTED_ALGORITHM'
  | 'ALTERED_PAYLOAD'
  | 'SIGNING_KEY_MISMATCH'
  | 'SIGNING_KEY_REVOKED'
  | 'SIGNING_KEY_COMPROMISED'
  | 'SIGNING_KEY_NOT_VALID';

export type EnvelopeVerificationResult =
  | { ok: true; state: 'VERIFIED' }
  | { ok: false; state: 'FAILED' | 'EXPIRED'; reason: EnvelopeVerificationFailure };

function unsignedEnvelope(envelope: M2MEnvelope): M2MEnvelopeUnsigned {
  const { signature: _signature, ...unsigned } = envelope;
  return unsigned;
}

function sign(algorithmId: string, message: Buffer, privateKeyPem: string): Buffer {
  requireActiveCryptoAlgorithm(algorithmId, 'signature');
  if (algorithmId === 'ed25519') return crypto.sign(null, message, privateKeyPem);
  if (algorithmId === 'ecdsa-p256-sha256') return crypto.sign('sha256', message, privateKeyPem);
  throw new Error('CRYPTO_ALGORITHM_IMPLEMENTATION_MISSING');
}

function verify(algorithmId: string, message: Buffer, signature: Buffer, publicKeyPem: string): boolean {
  requireActiveCryptoAlgorithm(algorithmId, 'signature');
  if (algorithmId === 'ed25519') return crypto.verify(null, message, publicKeyPem, signature);
  if (algorithmId === 'ecdsa-p256-sha256') return crypto.verify('sha256', message, publicKeyPem, signature);
  return false;
}

export function createM2MEnvelope(
  input: Omit<M2MEnvelopeUnsigned, 'schemaVersion'>,
  signingPrivateKeyPem: string
): M2MEnvelope {
  requireActiveCryptoAlgorithm(input.payloadDigestAlgorithm, 'hash');
  requireActiveCryptoAlgorithm(input.signingAlgorithm, 'signature');
  if (!input.envelopeId || !input.issuer || !input.recipient || !input.subject || !input.tenantId || !input.nonce) {
    throw new Error('M2M_ENVELOPE_REQUIRED_FIELD_MISSING');
  }
  if (!Number.isSafeInteger(input.sequence ?? 0) || (input.sequence ?? 0) < 0) throw new Error('M2M_SEQUENCE_INVALID');
  const createdAt = Date.parse(input.createdAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) throw new Error('M2M_TIME_WINDOW_INVALID');
  const unsigned: M2MEnvelopeUnsigned = { schemaVersion: 'spr-m2m-envelope/v1', ...input };
  const message = Buffer.from(canonicalJson(unsigned), 'utf8');
  return { ...unsigned, signature: sign(input.signingAlgorithm, message, signingPrivateKeyPem).toString('base64url') };
}

export interface M2MVerificationKey {
  record: CryptoKeyRecord & { algorithmId: string; tenantId: string; issuer: string };
  publicKeyPem: string;
}

export async function verifyM2MEnvelope(input: {
  envelope: M2MEnvelope;
  verificationKey: M2MVerificationKey;
  expectedTenantId: string;
  expectedRecipient: string;
  allowedIssuers: ReadonlySet<string>;
  replayStore: M2MReplayStore;
  nowMs?: number;
  payload?: string | Buffer;
}): Promise<EnvelopeVerificationResult> {
  const { envelope } = input;
  try {
    if (envelope.schemaVersion !== 'spr-m2m-envelope/v1') return { ok: false, state: 'FAILED', reason: 'INVALID_SCHEMA' };
    if (envelope.tenantId !== input.expectedTenantId) return { ok: false, state: 'FAILED', reason: 'WRONG_TENANT' };
    if (envelope.recipient !== input.expectedRecipient) return { ok: false, state: 'FAILED', reason: 'WRONG_RECIPIENT' };
    if (!input.allowedIssuers.has(envelope.issuer)) return { ok: false, state: 'FAILED', reason: 'UNAUTHORIZED_ISSUER' };
    requireActiveCryptoAlgorithm(envelope.payloadDigestAlgorithm, 'hash');
    requireActiveCryptoAlgorithm(envelope.signingAlgorithm, 'signature');
    const key = input.verificationKey.record;
    if (
      key.keyId !== envelope.signingKeyId ||
      key.algorithmId !== envelope.signingAlgorithm ||
      key.tenantId !== envelope.tenantId ||
      key.issuer !== envelope.issuer
    ) return { ok: false, state: 'FAILED', reason: 'SIGNING_KEY_MISMATCH' };
    const now = input.nowMs ?? Date.now();
    const keyDecision = evaluateKeyForNewSignature(key, now);
    if (!keyDecision.allowed) {
      if (keyDecision.state === 'REVOKED') return { ok: false, state: 'FAILED', reason: 'SIGNING_KEY_REVOKED' };
      if (keyDecision.state === 'COMPROMISED') return { ok: false, state: 'FAILED', reason: 'SIGNING_KEY_COMPROMISED' };
      return { ok: false, state: 'FAILED', reason: 'SIGNING_KEY_NOT_VALID' };
    }
    const created = Date.parse(envelope.createdAt);
    const expires = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(created) || !Number.isFinite(expires)) return { ok: false, state: 'FAILED', reason: 'MALFORMED' };
    if (created > now + 5 * 60_000) return { ok: false, state: 'FAILED', reason: 'NOT_YET_VALID' };
    if (expires <= now) return { ok: false, state: 'EXPIRED', reason: 'EXPIRED' };
    if (input.payload !== undefined) {
      const computed = digestUtf8(envelope.payloadDigestAlgorithm, Buffer.isBuffer(input.payload) ? input.payload.toString('utf8') : input.payload);
      if (computed !== envelope.payloadDigest) return { ok: false, state: 'FAILED', reason: 'ALTERED_PAYLOAD' };
    }
    const message = Buffer.from(canonicalJson(unsignedEnvelope(envelope)), 'utf8');
    const signature = Buffer.from(envelope.signature, 'base64url');
    if (!verify(envelope.signingAlgorithm, message, signature, input.verificationKey.publicKeyPem)) {
      return { ok: false, state: 'FAILED', reason: 'INVALID_SIGNATURE' };
    }
    const fresh = await input.replayStore.consumeNonce({
      issuer: envelope.issuer,
      tenantId: envelope.tenantId,
      nonce: envelope.nonce,
      envelopeId: envelope.envelopeId,
      expiresAt: envelope.expiresAt,
    });
    if (!fresh) return { ok: false, state: 'FAILED', reason: 'DUPLICATE_NONCE' };
    return { ok: true, state: 'VERIFIED' };
  } catch (error) {
    if (error instanceof Error && /CRYPTO_ALGORITHM/.test(error.message)) {
      return { ok: false, state: 'FAILED', reason: 'UNEXPECTED_ALGORITHM' };
    }
    return { ok: false, state: 'FAILED', reason: 'MALFORMED' };
  }
}
