import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 1;

type CredentialMap = Record<string, string>;

function masterKey() {
  const raw = process.env.SPR_INTEGRATION_MASTER_KEY?.trim();
  if (!raw) throw new Error('INTEGRATION_MASTER_KEY_MISSING');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('INTEGRATION_MASTER_KEY_INVALID');
  return key;
}

export function encryptCredentials(credentials: CredentialMap) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv);
  const plaintext = JSON.stringify(credentials);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${VERSION}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptCredentials(payload: string): CredentialMap {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = payload.split('.');
  if (version !== `v${VERSION}` || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('CREDENTIAL_CIPHERTEXT_INVALID');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const value: unknown = JSON.parse(plaintext);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('CREDENTIAL_PAYLOAD_INVALID');
    }

    const result: CredentialMap = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof key === 'string' && typeof val === 'string') result[key] = val;
    }
    return result;
  } catch {
    throw new Error('CREDENTIAL_DECRYPT_FAILED');
  }
}
