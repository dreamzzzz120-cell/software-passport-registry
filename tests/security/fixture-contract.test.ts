import { describe, expect, it } from 'vitest';

// Only meaningful as part of the live route-security CI job (see
// .github/workflows/security-route-tests.yml), which is the only place these
// env vars are ever set — skipped everywhere else so it doesn't fail the
// general test run/CI gate.
const enabled = process.env.SPR_SECURITY_TEST_AUTH === 'true' && process.env.NODE_ENV === 'test';
const suite = enabled ? describe : describe.skip;

const required = [
  'SPR_TEST_DATABASE_URL',
  'SPR_TEST_TENANT_A_UID',
  'SPR_TEST_TENANT_B_UID',
] as const;

suite('isolated security fixture contract', () => {
  it('refuses production database configuration and requires isolated test auth', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.SPR_SECURITY_TEST_AUTH).toBe('true');
    expect(process.env.SPR_TEST_DATABASE_URL).toContain('127.0.0.1');
    expect(process.env.DATABASE_URL).toContain('127.0.0.1');
    expect(process.env.APP_DATABASE_URL).toContain('127.0.0.1');
  });

  it('requires explicit tenant fixtures before authenticated attack tests run', () => {
    const missing = required.filter((key) => !process.env[key]);
    expect(missing).toEqual([]);
  });
});
