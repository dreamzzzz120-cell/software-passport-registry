import { describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const enabled = process.env.NODE_ENV === 'test' && Boolean(emulatorHost) && process.env.SPR_SECURITY_TEST_AUTH === 'true';

const suite = enabled ? describe : describe.skip;

async function createEmulatorUser(localId: string, email: string) {
  const response = await fetch(`http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-spr-security`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localId, email, password: 'SecurityTest-Only-123!', returnSecureToken: true }),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ localId: string; idToken: string; refreshToken: string }>;
}

suite('Firebase emulator tenant identities', () => {
  it('creates isolated Tenant A and Tenant B identities', async () => {
    const tenantA = await createEmulatorUser('tenant-a-test-user', 'tenant-a@security.test');
    const tenantB = await createEmulatorUser('tenant-b-test-user', 'tenant-b@security.test');

    expect(tenantA.localId).toBe('tenant-a-test-user');
    expect(tenantB.localId).toBe('tenant-b-test-user');
    expect(tenantA.idToken).not.toBe(tenantB.idToken);
  });
});
