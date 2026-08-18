import crypto from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { decryptCredential, encryptCredential } from './credential-vault.ts';

describe('credential vault', () => {
  beforeEach(() => {
    process.env.SPR_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64url');
  });

  it('encrypts and decrypts credentials without exposing plaintext', () => {
    const payload = { token: 'super-secret-token', username: 'collector' };
    const encrypted = encryptCredential(payload, 'tenant-a', 'github');

    expect(encrypted.ciphertext).not.toContain('super-secret-token');
    expect(encrypted.ciphertext.split('.')).toHaveLength(4);
    expect(decryptCredential(encrypted.ciphertext, 'tenant-a', 'github')).toEqual(payload);
  });

  it('binds ciphertext to tenant and provider', () => {
    const encrypted = encryptCredential({ token: 'secret' }, 'tenant-a', 'github');

    expect(() => decryptCredential(encrypted.ciphertext, 'tenant-b', 'github')).toThrow();
    expect(() => decryptCredential(encrypted.ciphertext, 'tenant-a', 'gitlab')).toThrow();
  });

  it('fails closed when the encryption key is absent or malformed', () => {
    delete process.env.SPR_CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptCredential({ token: 'secret' }, 'tenant-a', 'github')).toThrow();

    process.env.SPR_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(31).toString('base64url');
    expect(() => encryptCredential({ token: 'secret' }, 'tenant-a', 'github')).toThrow();
  });
});
