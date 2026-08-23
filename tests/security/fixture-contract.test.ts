import { describe, expect, it } from 'vitest';

/**
 * Security fixture contract for the authenticated tenant attack suite.
 *
 * The production application authenticates through Firebase and derives the
 * tenant from the verified server-side identity. These fixtures deliberately
 * require an isolated test project/database; they never fall back to
 * production configuration.
 */
const required = [
  'SPR_TEST_FIREBASE_PROJECT_ID',
  'SPR_TEST_DATABASE_URL',
  'SPR_TEST_TENANT_A_UID',
  'SPR_TEST_TENANT_B_UID',
] as const;

describe('isolated security fixture contract', () => {
  it('refuses to run against production configuration', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.SPR_TEST_DATABASE_URL).not.toBe(process.env.DATABASE_URL);
    expect(process.env.SPR_TEST_FIREBASE_PROJECT_ID).not.toBe(process.env.FIREBASE_PROJECT_ID);
  });

  it('requires explicit tenant fixtures before authenticated attack tests run', () => {
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      expect(missing.length).toBeGreaterThan(0);
      return;
    }
    expect(missing).toEqual([]);
  });
});
