import { describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const enabled = process.env.NODE_ENV === 'test' && Boolean(emulatorHost) && process.env.SPR_SECURITY_TEST_AUTH === 'true';

const suite = enabled ? describe : describe.skip;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

// This test used to mint its own Tenant A/B users via a direct signUp call
// with a caller-supplied localId ("tenant-a-test-user"). The emulator's
// public signUp endpoint rejects a caller-supplied localId with a bare 400
// (confirmed against firebase-tools' own emulator source: only a privileged,
// OAuth2-style caller may set localId on signUp), so that call never
// succeeded on any run of this job. It was also redundant: the CI workflow's
// own "Create isolated emulator identities" step (see #74) already creates
// these exact two users -- tenant-a@security.test and tenant-b@security.test
// -- via the Admin SDK, which is the only way this emulator allows setting
// emailVerified/localId at all. A second signUp for the same emails would
// additionally now collide with EMAIL_EXISTS even if the localId problem
// were fixed.
//
// What this test can actually verify -- and what its name promises -- is
// that those two identities the workflow created are genuinely isolated: two
// different, verified users with two different tokens, not the same
// identity by accident.
suite('Firebase emulator tenant identities', () => {
  it('creates isolated Tenant A and Tenant B identities', () => {
    const tokenA = process.env.SPR_TEST_TENANT_A_ID_TOKEN;
    const tokenB = process.env.SPR_TEST_TENANT_B_ID_TOKEN;
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);

    const claimsA = decodeJwtPayload(tokenA!);
    const claimsB = decodeJwtPayload(tokenB!);
    expect(claimsA.user_id).toBeTruthy();
    expect(claimsB.user_id).toBeTruthy();
    expect(claimsA.user_id).not.toBe(claimsB.user_id);
    expect(claimsA.user_id).toBe(process.env.SPR_TEST_TENANT_A_UID);
    expect(claimsB.user_id).toBe(process.env.SPR_TEST_TENANT_B_UID);
    expect(claimsA.email).toBe('tenant-a@security.test');
    expect(claimsB.email).toBe('tenant-b@security.test');
    // The whole point of #74 upstream of this test: a token that does not
    // actually carry a verified email is not an isolated, usable identity,
    // it is a token requireAuth will reject outright.
    expect(claimsA.email_verified).toBe(true);
    expect(claimsB.email_verified).toBe(true);
  });
});
