import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { digestUtf8 } from '../src/crypto/algorithm-registry.ts';
import { createM2MEnvelope, verifyM2MEnvelope, type M2MReplayStore } from '../src/crypto/m2m-envelope.ts';

class TestReplayStore implements M2MReplayStore {
  private readonly seen = new Set<string>();
  async consumeNonce(input: { issuer: string; tenantId: string; nonce: string; envelopeId: string; expiresAt: string }): Promise<boolean> {
    const key = [input.tenantId, input.issuer, input.nonce].join(':');
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

describe('SPR M2M envelope contract', () => {
  const keys = () => crypto.generateKeyPairSync('ed25519');
  const verificationKey = (publicKeyPem: string, state: 'ACTIVE'|'DEPRECATED'|'REVOKED'|'COMPROMISED' = 'ACTIVE') => ({
    record: {
      keyId: 'key-1',
      algorithmId: 'ed25519',
      tenantId: 'tenant-a',
      issuer: 'spr',
      state,
      ...(state === 'REVOKED' ? { revokedAt: new Date().toISOString() } : {}),
      ...(state === 'COMPROMISED' ? { compromisedAt: new Date().toISOString() } : {}),
    },
    publicKeyPem,
  });
  const base = (privateKeyPem: string) => createM2MEnvelope({
    envelopeId: 'env-1',
    issuer: 'spr',
    recipient: 'constellation',
    subject: 'artifact-1',
    tenantId: 'tenant-a',
    evidenceReferences: ['ev-1'],
    payloadDigestAlgorithm: 'sha2-256',
    payloadDigest: digestUtf8('sha2-256', 'payload'),
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: 'nonce-1',
    sequence: 1,
    signingAlgorithm: 'ed25519',
    signingKeyId: 'key-1',
  }, privateKeyPem);

  it('verifies a correct signed envelope once and rejects replay', async () => {
    const { privateKey, publicKey } = keys();
    const envelope = base(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const replayStore = new TestReplayStore();
    const args = {
      envelope,
      verificationKey: verificationKey(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
      expectedTenantId: 'tenant-a',
      expectedRecipient: 'constellation',
      allowedIssuers: new Set(['spr']),
      replayStore,
      payload: 'payload',
    };
    await expect(verifyM2MEnvelope(args)).resolves.toEqual({ ok: true, state: 'VERIFIED' });
    await expect(verifyM2MEnvelope(args)).resolves.toEqual({ ok: false, state: 'FAILED', reason: 'DUPLICATE_NONCE' });
  });

  it('rejects wrong tenant, recipient, issuer, payload and signature', async () => {
    const { privateKey, publicKey } = keys();
    const envelope = base(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const verify = (overrides: Record<string, unknown>) => verifyM2MEnvelope({
      envelope,
      verificationKey: verificationKey(publicKeyPem),
      expectedTenantId: 'tenant-a',
      expectedRecipient: 'constellation',
      allowedIssuers: new Set(['spr']),
      replayStore: new TestReplayStore(),
      payload: 'payload',
      ...overrides,
    } as any);

    await expect(verify({ expectedTenantId: 'tenant-b' })).resolves.toMatchObject({ ok: false, reason: 'WRONG_TENANT' });
    await expect(verify({ expectedRecipient: 'datasphere' })).resolves.toMatchObject({ ok: false, reason: 'WRONG_RECIPIENT' });
    await expect(verify({ allowedIssuers: new Set(['other']) })).resolves.toMatchObject({ ok: false, reason: 'UNAUTHORIZED_ISSUER' });
    await expect(verify({ payload: 'tampered' })).resolves.toMatchObject({ ok: false, reason: 'ALTERED_PAYLOAD' });
    await expect(verify({ envelope: { ...envelope, subject: 'artifact-2' } })).resolves.toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
    await expect(verify({ verificationKey: verificationKey(publicKeyPem, 'REVOKED') })).resolves.toMatchObject({ ok: false, reason: 'SIGNING_KEY_REVOKED' });
    await expect(verify({ verificationKey: verificationKey(publicKeyPem, 'COMPROMISED') })).resolves.toMatchObject({ ok: false, reason: 'SIGNING_KEY_COMPROMISED' });
    await expect(verify({ verificationKey: { ...verificationKey(publicKeyPem), record: { ...verificationKey(publicKeyPem).record, tenantId: 'tenant-b' } } })).resolves.toMatchObject({ ok: false, reason: 'SIGNING_KEY_MISMATCH' });
  });

  it('rejects expired and not-yet-valid envelopes', async () => {
    const { privateKey, publicKey } = keys();
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const now = Date.now();
    const expired = createM2MEnvelope({
      envelopeId: 'expired', issuer: 'spr', recipient: 'constellation', subject: 'a', tenantId: 'tenant-a',
      evidenceReferences: [], payloadDigestAlgorithm: 'sha2-256', payloadDigest: digestUtf8('sha2-256','payload'),
      createdAt: new Date(now - 10_000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
      nonce: 'n-expired', signingAlgorithm: 'ed25519', signingKeyId: 'key-1',
    }, pem);
    await expect(verifyM2MEnvelope({
      envelope: expired, verificationKey: verificationKey(pub), expectedTenantId: 'tenant-a', expectedRecipient: 'constellation',
      allowedIssuers: new Set(['spr']), replayStore: new TestReplayStore(), nowMs: now, payload: 'payload'
    })).resolves.toMatchObject({ ok: false, state: 'EXPIRED', reason: 'EXPIRED' });

    const future = createM2MEnvelope({
      envelopeId: 'future', issuer: 'spr', recipient: 'constellation', subject: 'a', tenantId: 'tenant-a',
      evidenceReferences: [], payloadDigestAlgorithm: 'sha2-256', payloadDigest: digestUtf8('sha2-256','payload'),
      createdAt: new Date(now + 10 * 60_000).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(),
      nonce: 'n-future', signingAlgorithm: 'ed25519', signingKeyId: 'key-1',
    }, pem);
    await expect(verifyM2MEnvelope({
      envelope: future, verificationKey: verificationKey(pub), expectedTenantId: 'tenant-a', expectedRecipient: 'constellation',
      allowedIssuers: new Set(['spr']), replayStore: new TestReplayStore(), nowMs: now, payload: 'payload'
    })).resolves.toMatchObject({ ok: false, reason: 'NOT_YET_VALID' });
  });
});
