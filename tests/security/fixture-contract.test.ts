import { describe, expect, it } from 'vitest';

const required = [
  'SPR_TEST_FIREBASE_PROJECT_ID',
  'SPR_TEST_DATABASE_URL',
  'SPR_TEST_TENANT_A_UID',
  'SPR_TEST_TENANT_B_UID',
] as const;

describe('isolated security fixture contract', () => {
  it('refuses production database and Firebase configuration', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.SPR_TEST_DATABASE_URL).toContain('127.0.0.1');
    expect(process.env.DATABASE_URL).toContain('127.0.0.1');
    expect(process.env.SPR_TEST_FIREBASE_PROJECT_ID).toBe('demo-spr-security');
    if (process.env.FIREBASE_PROJECT_ID) {
      expect(process.env.FIREBASE_PROJECT_ID).toBe(process.env.SPR_TEST_FIREBASE_PROJECT_ID);
    }
  });

  it('requires explicit tenant fixtures before authenticated attack tests run', () => {
    const missing = required.filter((key) => !process.env[key]);
    expect(missing).toEqual([]);
  });
});
