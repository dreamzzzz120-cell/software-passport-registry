import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = process.env.SPR_CREDENTIAL_ENCRYPTION_KEY_VERSION || 'v1';

function loadKey(): Buffer {
  const encoded = process.env.SPR_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new Error('SPR_CREDENTIAL_ENCRYPTION_KEY is required');

  let key: Buffer;
  try {
    key = Buffer.from(encoded, 'base64url');
  } catch {
    throw new Error('SPR_CREDENTIAL_ENCRYPTION_KEY must be base64url encoded');
  }

  if (key.length !== KEY_BYTES) {
    throw new Error('SPR_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

function aad(tenantId: string, provider: string): Buffer {
  if (!tenantId || !provider) throw new Error('Credential tenant and provider are required');
  return Buffer.from(`spr-credential:${tenantId}:${provider}`, 'utf8');
}

export function encryptCredential(payload: unknown, tenantId: string, provider: string): {
  ciphertext: string;
  keyVersion: string;
} {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(tenantId, provider));

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // v1.iv.tag.ciphertext; all components are base64url and contain no secrets
  // outside the encrypted ciphertext.
  const ciphertext = [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');

  return { ciphertext, keyVersion: VERSION };
}

export function decryptCredential<T = unknown>(
  ciphertext: string,
  tenantId: string,
  provider: string,
): T {
  const parts = ciphertext.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported credential ciphertext version');
  }

  const [, ivEncoded, tagEncoded, encryptedEncoded] = parts;
  const iv = Buffer.from(ivEncoded, 'base64url');
  const tag = Buffer.from(tagEncoded, 'base64url');
  const encrypted = Buffer.from(encryptedEncoded, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || encrypted.length === 0) {
    throw new Error('Invalid credential ciphertext');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, loadKey(), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(tenantId, provider));
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function credentialFingerprint(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}
