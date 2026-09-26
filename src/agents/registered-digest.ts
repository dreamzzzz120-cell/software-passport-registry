/** A record comparison, not an assertion that a publisher or binary was authenticated. */
export type RegisteredDigestState = 'REGISTERED_DIGEST_MATCH' | 'REGISTERED_DIGEST_DIFFERENT' | 'UNKNOWN';
const sha256 = /^[a-f0-9]{64}$/i;

export function compareRegisteredDigest(passport: { id: string; fileHash: string }, suppliedDigest: string, at = new Date()) {
  const supplied = suppliedDigest.replace(/^sha256:/i, '').toLowerCase();
  const registered = String(passport.fileHash ?? '').replace(/^sha256:/i, '').toLowerCase();
  const comparable = sha256.test(supplied) && sha256.test(registered);
  const state: RegisteredDigestState = !comparable ? 'UNKNOWN'
    : supplied === registered ? 'REGISTERED_DIGEST_MATCH' : 'REGISTERED_DIGEST_DIFFERENT';
  return {
    schemaVersion: 'spr-registered-digest-v1', passportId: passport.id, state,
    suppliedDigest: sha256.test(supplied) ? `sha256:${supplied}` : null,
    registeredDigest: sha256.test(registered) ? `sha256:${registered}` : null,
    generatedAt: at.toISOString(), identityVerified: false,
    trustDecision: 'NOT_EVALUATED', evidenceIds: [],
    reason: !sha256.test(supplied) ? 'INVALID_SUPPLIED_DIGEST'
      : !sha256.test(registered) ? 'REGISTERED_DIGEST_UNAVAILABLE'
      : state === 'REGISTERED_DIGEST_MATCH' ? 'DIGEST_MATCHES_PASSPORT_RECORD' : 'DIGEST_DIFFERS_FROM_PASSPORT_RECORD',
    limitation: 'This compares an input with a stored passport field. It does not authenticate the artifact, publisher, source, or passport registration.'
  };
}
