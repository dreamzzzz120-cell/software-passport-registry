import { describe, expect, it } from 'vitest';
import { assessHistoricalVerification, evaluateKeyForNewSignature } from '../src/crypto/key-policy.ts';

describe('crypto key lifecycle policy', () => {
  it('blocks revoked and compromised keys from new signatures', () => {
    expect(evaluateKeyForNewSignature({ keyId:'k1', state:'REVOKED', revokedAt:new Date().toISOString() }).allowed).toBe(false);
    expect(evaluateKeyForNewSignature({ keyId:'k2', state:'COMPROMISED', compromisedAt:new Date().toISOString() }).allowed).toBe(false);
  });

  it('preserves historical verification while requiring re-attestation after later compromise', () => {
    const signedAt = new Date(Date.now() - 60_000).toISOString();
    const compromisedAt = new Date(Date.now() - 30_000).toISOString();
    const result = assessHistoricalVerification({
      key: { keyId:'k1', state:'COMPROMISED', compromisedAt },
      signedAt,
      cryptographicallyVerified: true,
    });
    expect(result.cryptographicVerificationAtObservedTime).toBe('VERIFIED');
    expect(result.laterCompromised).toBe(true);
    expect(result.reAttestationRequired).toBe(true);
  });

  it('keeps unknown historical verification unknown', () => {
    const result = assessHistoricalVerification({
      key: { keyId:'k1', state:'ACTIVE' },
      signedAt: new Date().toISOString(),
      cryptographicallyVerified: null,
    });
    expect(result.cryptographicVerificationAtObservedTime).toBe('UNKNOWN');
  });
});
