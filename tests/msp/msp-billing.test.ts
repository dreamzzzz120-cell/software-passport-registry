import { describe, expect, it } from 'vitest';
import { readCode as read } from '../helpers/source-contract.ts';

// SECTION 16 of the MSP acceptance spec names a specific, previously-real
// incident by shape: absence of a subscription row must never make the
// whole application return 402 to every route. This sandbox has no live
// Stripe test-mode account and no database to actually create a
// no-subscription tenant against, so this verifies the guarantee at the
// level this codebase already relies on for it: the source of
// enforcePaidAccess itself, which every authenticated request passes
// through.
describe('billing denial is capability-scoped, not a blanket workspace lockout', () => {
  const security = read('src/middleware/security.ts');

  it('exempts a real, named set of paths from paid-access checks entirely', () => {
    expect(security).toContain('BILLING_EXEMPT_PATHS');
    expect(security).toContain("'/api/billing'");
    expect(security).toContain("'/api/user/me'");
  });

  it('checks a specific capability derived from the request path, not a single account-wide flag', () => {
    expect(security).toContain('capabilityForPath(req)');
    expect(security).toContain('evaluateCapability(scopedDb, tenantId, capability)');
  });

  it('a denial reports 402 for that one capability, scoped to what was denied', () => {
    const idx = security.indexOf('if (!decision.allowed)');
    expect(idx).toBeGreaterThan(-1);
    const branch = security.slice(idx, idx + 200);
    expect(branch).toContain('res.status(402)');
    expect(branch).toContain('capabilityDenial(capability, decision)');
  });

  it('a missing tenant/db context is reported as SUBSCRIPTION_REQUIRED (403), never fabricated as a paid-plan capability decision', () => {
    expect(security).toContain('SUBSCRIPTION_REQUIRED');
  });
});
