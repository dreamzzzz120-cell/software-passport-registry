export type CryptoKeyState = 'ACTIVE' | 'DEPRECATED' | 'REVOKED' | 'COMPROMISED';

export interface CryptoKeyRecord {
  keyId: string;
  state: CryptoKeyState;
  notBefore?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  compromisedAt?: string | null;
}

export type KeyUseDecision =
  | { allowed: true; state: 'ACTIVE' | 'DEPRECATED' }
  | { allowed: false; state: 'REVOKED' | 'COMPROMISED' | 'EXPIRED' | 'NOT_YET_VALID' };

export function evaluateKeyForNewSignature(key: CryptoKeyRecord, nowMs = Date.now()): KeyUseDecision {
  const notBefore = key.notBefore ? Date.parse(key.notBefore) : null;
  const expiresAt = key.expiresAt ? Date.parse(key.expiresAt) : null;
  if (notBefore !== null && Number.isFinite(notBefore) && nowMs < notBefore) return { allowed: false, state: 'NOT_YET_VALID' };
  if (expiresAt !== null && Number.isFinite(expiresAt) && nowMs >= expiresAt) return { allowed: false, state: 'EXPIRED' };
  if (key.state === 'REVOKED') return { allowed: false, state: 'REVOKED' };
  if (key.state === 'COMPROMISED') return { allowed: false, state: 'COMPROMISED' };
  return { allowed: true, state: key.state };
}

export interface HistoricalVerificationAssessment {
  cryptographicVerificationAtObservedTime: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  keyStateNow: CryptoKeyState;
  laterRevoked: boolean;
  laterCompromised: boolean;
  reAttestationRequired: boolean;
}

/**
 * Historical proof is not erased by a later key event. We preserve what was
 * cryptographically observed at the time, while separately recording that a
 * later compromise/revocation changes present-day reliance.
 */
export function assessHistoricalVerification(input: {
  key: CryptoKeyRecord;
  signedAt: string;
  cryptographicallyVerified: boolean | null;
}): HistoricalVerificationAssessment {
  const signedAtMs = Date.parse(input.signedAt);
  if (!Number.isFinite(signedAtMs)) throw new Error('INVALID_SIGNATURE_TIMESTAMP');
  const compromisedAt = input.key.compromisedAt ? Date.parse(input.key.compromisedAt) : null;
  const revokedAt = input.key.revokedAt ? Date.parse(input.key.revokedAt) : null;
  const laterCompromised = compromisedAt !== null && Number.isFinite(compromisedAt) && compromisedAt > signedAtMs;
  const laterRevoked = revokedAt !== null && Number.isFinite(revokedAt) && revokedAt > signedAtMs;
  return {
    cryptographicVerificationAtObservedTime: input.cryptographicallyVerified === null
      ? 'UNKNOWN'
      : input.cryptographicallyVerified ? 'VERIFIED' : 'FAILED',
    keyStateNow: input.key.state,
    laterRevoked,
    laterCompromised,
    reAttestationRequired: input.key.state === 'COMPROMISED' || input.key.state === 'REVOKED',
  };
}
