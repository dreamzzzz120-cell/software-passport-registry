import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildGoogleServiceAccountJwt } from './adapters.ts';

function fakeServiceAccountKey(overrides: Partial<Record<string, unknown>> = {}): string {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return JSON.stringify({
    type: 'service_account',
    project_id: 'spr-test-project',
    private_key: privateKey,
    client_email: 'spr-connector@spr-test-project.iam.gserviceaccount.com',
    ...overrides,
  });
}

// Real bug this guards against: a Google service-account key cannot be used
// as a bearer token directly (unlike every other provider's credential) --
// it must sign a short-lived JWT and exchange it via Google's token
// endpoint (RFC 7523). This only tests the JWT construction itself, which
// is fully deterministic and needs no network access; the actual token
// exchange (mintGoogleServiceAccountAccessToken) is exercised for real
// whenever a user connects Google Cloud with a real key.
describe('buildGoogleServiceAccountJwt', () => {
  it('produces a three-part JWT signed with the service account private key', () => {
    const key = fakeServiceAccountKey();
    const { jwt, tokenUri } = buildGoogleServiceAccountJwt(key, 'https://www.googleapis.com/auth/cloud-platform.read-only', 1_700_000_000);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    expect(tokenUri).toBe('https://oauth2.googleapis.com/token');

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims.iss).toBe('spr-connector@spr-test-project.iam.gserviceaccount.com');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform.read-only');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.exp - claims.iat).toBe(3600);

    const parsedKey = JSON.parse(key);
    const signature = Buffer.from(parts[2], 'base64url');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    expect(verifier.verify(parsedKey.private_key, signature)).toBe(true);
  });

  it('respects a custom token_uri from the key file', () => {
    const key = fakeServiceAccountKey({ token_uri: 'https://oauth2.example-alt.googleapis.com/token' });
    const { tokenUri } = buildGoogleServiceAccountJwt(key, 'scope');
    expect(tokenUri).toBe('https://oauth2.example-alt.googleapis.com/token');
  });

  it('rejects invalid JSON instead of throwing an opaque parse error', () => {
    expect(() => buildGoogleServiceAccountJwt('not json', 'scope')).toThrow('GOOGLE_SERVICE_ACCOUNT_KEY_INVALID_JSON');
  });

  it('rejects a key missing required fields', () => {
    expect(() => buildGoogleServiceAccountJwt(JSON.stringify({ type: 'service_account' }), 'scope')).toThrow('GOOGLE_SERVICE_ACCOUNT_KEY_MISSING_FIELDS');
  });

  it('rejects a non-service-account key type', () => {
    expect(() => buildGoogleServiceAccountJwt(JSON.stringify({ type: 'authorized_user', client_email: 'x', private_key: 'y' }), 'scope')).toThrow('GOOGLE_SERVICE_ACCOUNT_KEY_MISSING_FIELDS');
  });
});
