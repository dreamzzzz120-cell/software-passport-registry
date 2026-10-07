import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/config.ts', () => ({ config: { publicPassport: { secret: 'test-report-token-secret-never-used-in-production' } } }));
vi.mock('../src/db/index.ts', () => ({ db: {} }));
vi.mock('../src/middleware/security.ts', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('../src/middleware/tenant-scope.ts', () => ({ attachTenantScope: vi.fn() }));
vi.mock('../src/security/entitlements.ts', () => ({ enforceCapability: vi.fn() }));
import { verifyPublicReportToken } from '../src/routes/public-connect';

const secret = 'test-report-token-secret-never-used-in-production';
const sign = (fields: Record<string, unknown>) => {
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'report', passportId: 'p1', tenantId: 't1', reportType: 'executive', exp: Math.floor(Date.now() / 1000) + 60, ...fields })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
describe('signed public report token type', () => {
  it.each(['executive', 'technical', 'msp', 'customer', 'compliance', 'vendor', 'auditor', 'evidence-ledger'])('accepts supported type %s', reportType => {
    expect(verifyPublicReportToken(sign({ reportType }), 'p1')?.reportType).toBe(reportType);
  });
  it.each(['unsupported', '../admin', '', null, 123, ['executive']])('rejects a valid signature with an unsupported type %j', reportType => {
    expect(verifyPublicReportToken(sign({ reportType }), 'p1')).toBeNull();
  });
  it('still rejects expiry, wrong Passport, wrong token kind and a tampered signature', () => {
    expect(verifyPublicReportToken(sign({ exp: 1 }), 'p1')).toBeNull();
    expect(verifyPublicReportToken(sign({}), 'p2')).toBeNull();
    expect(verifyPublicReportToken(sign({ kind: 'passport' }), 'p1')).toBeNull();
    expect(verifyPublicReportToken(`${sign({})}x`, 'p1')).toBeNull();
  });
});
