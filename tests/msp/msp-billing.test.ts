import { describe, expect, it } from 'vitest';
import { readCode as read } from '../helpers/source-contract.ts';

// Launch policy: an authenticated MSP may reach identity and billing routes,
 // but paid workspace capabilities must fail closed until Stripe-backed
 // subscription state is entitling. This suite locks that boundary in place.
describe('billing denial is capability-scoped and unpaid workspaces fail closed', () => {
  const security = read('src/middleware/security.ts');

  it('exempts a real, named set of paths from paid-access checks entirely', () => {
    expect(security).toContain('BILLING_EXEMPT_PATHS');
    expect(security).toContain("'/api/billing'");
    expect(security).toContain("'/api/user/me'");
  });


  it('treats no confirmed plan as unpaid instead of unrestricted access', () => {
    const entitlements = read('src/security/entitlements.ts');
    expect(entitlements).toContain("export type SubscriptionGate = 'unpaid' | 'enforce-plan' | 'trial' | 'lapsed'");
    expect(entitlements).toContain("if (!subscription.plan) return 'unpaid';");
    expect(entitlements).toContain("if (gate === 'unpaid') return { allowed: false, gate, state };");
    expect(entitlements).toContain("message: 'Choose an SPR plan to unlock the MSP workspace.'");
  });

  it('keeps billing and identity routes reachable so an unpaid MSP can subscribe', () => {
    expect(security).toContain("'/api/billing'");
    expect(security).toContain("'/api/user/me'");
    expect(security).toContain('isBillingExemptPath(req)');
  });

  it('keeps canceled and unpaid plans out of the paid workspace too', () => {
    const entitlements = read('src/security/entitlements.ts');
    expect(entitlements).toContain('export function lapsedPlanAllows(_capability: Capability): boolean');
    expect(entitlements).toContain('return false;');
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
