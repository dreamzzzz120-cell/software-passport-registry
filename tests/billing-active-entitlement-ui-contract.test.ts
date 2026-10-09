import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = () => fs.readFileSync(path.join(root, 'src/components/BillingView.tsx'), 'utf8');

describe('Billing active-entitlement UI contract', () => {
  it('treats only Stripe active status as an unlocked workspace plan', () => {
    const s = source();
    expect(s).toContain("const entitlementActive = (subscriptionStatus === 'active' || trialActive)");
    expect(s).not.toContain("new Set(['active', 'trialing', 'past_due'])");
    expect(s).toContain('Workspace access is locked until Stripe reports this subscription as active.');
  });

  it('does not label a non-active recorded plan as the current active plan', () => {
    const s = source();
    expect(s).toContain('Recorded plan');
    expect(s).toContain('No active workspace subscription');
    expect(s).toContain('Active plan');
  });

  it('keeps add-on purchase disabled until the base plan is active', () => {
    const s = source();
    expect(s).toContain('disabled={!entitlementActive || !addon.checkoutAvailable || anyBusy}');
    expect(s).toContain("!entitlementActive ? 'Active plan required'");
    expect(s).toContain('An active SPR plan is required before add-ons can be purchased.');
  });

  it('still leaves one-time reports available without a subscription', () => {
    const s = source();
    expect(s).toContain('One-time reports remain available without a subscription.');
    expect(s).toContain('No subscription required.');
  });
});
