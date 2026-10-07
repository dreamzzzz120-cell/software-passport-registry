import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('founder entitlement override contract', () => {
  const source = readFileSync('src/middleware/security.ts', 'utf8');

  it('uses only the explicit FOUNDER_EMAILS allowlist for the billing bypass', () => {
    expect(source).toContain('export function isFounderEmail');
    expect(source).toContain('config.founder.emails.includes(normalized)');
    expect(source).toContain('isFounderEmail(req.user?.email)');
    expect(source).toContain('founderOverride: true');
  });

  it('does not treat the tenant Owner role as founder access', () => {
    const paidAccess = source.slice(source.indexOf('export async function enforcePaidAccess'), source.indexOf('const VALID_ROLES'));
    expect(paidAccess).not.toContain("role === 'Owner'");
    expect(paidAccess).not.toContain('role === "Owner"');
  });
});
