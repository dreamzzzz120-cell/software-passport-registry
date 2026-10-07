import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDON_CONFIG, ONE_TIME_CONFIG, PLAN_CLIENT_LIMITS, PLAN_CONFIG } from '../src/routes/billing.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real billing backend: previously `stripe` was a listed dependency with
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET configured but never imported
// anywhere -- no checkout, no webhooks, no entitlements existed at all.
// 5-tier plan model (Pilot/Starter/Professional/Growth/Enterprise), per the
// commercial monetization spec. Plan *identity* and client limits live in
// PLAN_CONFIG; the amount is not restated here at all. Both the Price ID
// checkout uses and the figure the customer is shown come from Stripe -- the
// ID from configuration (see planPriceId), the amount from the Price object
// itself (see resolvePrices) -- so there is no second copy to drift.
describe('billing plan definitions', () => {
  it('defines exactly the 5 specified tiers with their specified client limits', () => {
    expect(PLAN_CLIENT_LIMITS).toEqual({ pilot: 2, starter: 5, professional: 25, growth: 100, enterprise: null });
  });

  it('never hard-codes a Stripe price ID -- only display labels for the specified prices', () => {
    const source = read('src/routes/billing.ts');
    expect(source).not.toMatch(/price_[A-Za-z0-9]{10,}/);
    // Price *IDs* must come only from config.stripe.prices (env vars), keyed
    // by each plan's priceKey -- e.g. `pilot` resolves through `mspPilot`
    // since it is priced/checked-out against the canonical MSP catalog.
    expect(source).toContain('config.stripe.prices[PLAN_CONFIG[plan].priceKey');
  });

  it('PLAN_CONFIG is the single source of truth PLAN_CLIENT_LIMITS is derived from, never maintained twice', () => {
    const source = read('src/routes/billing.ts');
    expect(source).toContain('Object.fromEntries(');
  });

  // Price *labels* used to be hardcoded here as well, and drifted away from
  // both the public pricing page and the Stripe Prices checkout actually
  // charges. No plan, product or add-on may carry a price of its own now.
  it('carries no hardcoded price for any plan, product or add-on', () => {
    for (const entry of [...Object.values(PLAN_CONFIG), ...Object.values(ONE_TIME_CONFIG), ...Object.values(ADDON_CONFIG)]) {
      expect(entry).not.toHaveProperty('priceLabel');
    }
    expect(read('src/routes/billing.ts')).not.toMatch(/priceLabel: '\$/);
  });
});

describe('prices are read from Stripe, never restated in SPR', () => {
  const source = () => read('src/routes/billing.ts');

  it('reads each configured price from the Stripe Price object itself', () => {
    const s = source();
    // The Price is still read from Stripe; the product is expanded alongside it
    // so the product's own description travels with the price it belongs to.
    expect(s).toContain("await stripe.prices.retrieve(id, { expand: ['product'] })");
    expect(s).toContain('price.unit_amount');
  });

  it('quotes nothing for a price it could not read, rather than a remembered figure', () => {
    const s = source();
    expect(s).toContain('priceLabel: price?.priceLabel ?? null');
    // A tiered/metered Price has no single amount to quote.
    expect(s).toContain('if (price.unit_amount == null || !price.active) return null;');
  });

  it('never offers checkout at a price it cannot state', () => {
    expect(source()).toContain('checkoutAvailable: Boolean(priceId) && price !== null');
  });

  it('serves one catalogue to both the pricing page and Billing', () => {
    const s = source();
    expect(s).toContain("router.get('/catalog'");
    expect(s).toContain('const catalog = await buildCatalog();');
    expect(read('src/components/MspPricingView.tsx')).toContain("apiFetch('/api/billing/catalog')");
  });

  // The labels these plans used to carry were checked once, by hand, against
  // the live Stripe Prices their priceKeys resolve to (starter $149/month,
  // professional $399/month, growth $799/month, all active recurring prices).
  // Reading them from Stripe on every refresh makes that check continuous
  // instead of a snapshot: a price changed in the Stripe dashboard tomorrow is
  // reflected here without a code change, and cannot silently disagree with
  // what the Subscribe button charges.
  it('keeps a Stripe read off the critical path of every page load', () => {
    expect(source()).toContain('PRICE_CACHE_TTL_MS');
  });
});

describe('billing routes are real, authenticated, and role-gated', () => {
  const source = () => read('src/routes/billing.ts');

  it('requires Owner to start checkout and Owner/Admin to manage billing', () => {
    const s = source();
    expect(s).toContain("router.post('/checkout', requireAuth, requireRole(['Owner'])");
    expect(s).toContain("router.post('/portal', requireAuth, requireRole(['Owner', 'Admin'])");
  });

  it('scopes subscription reads by tenant and only persists subscription state after Stripe confirmation', () => {
    const s = source();
    expect(s).toContain('WHERE tenant_id = ${tenantId}');
    const checkoutStart = s.indexOf("router.post('/checkout'");
    const checkoutEnd = s.indexOf("router.post('/one-time-checkout'");
    const checkout = s.slice(checkoutStart, checkoutEnd);
    expect(checkout).not.toContain('INSERT INTO tenant_subscriptions');
    expect(s).toContain('UPDATE tenant_subscriptions');
    expect(s).toContain("'billing.subscription.activated'");
  });

  it('never subscribes/checks out a plan with no configured Stripe price', () => {
    const s = source();
    expect(s).toContain('if (!priceId) return res.status(503)');
  });

  it('creates the tenant entitlement on Stripe confirmation using Stripe\'s authoritative subscription state', () => {
    const s = source();
    expect(s).toContain('INSERT INTO tenant_subscriptions (');
    expect(s).toContain('ON CONFLICT (tenant_id) DO UPDATE SET');
    expect(s).toContain('await stripe.subscriptions.retrieve(subscriptionId)');
    expect(s).toContain('status = EXCLUDED.status');
    expect(s).toContain("authoritativeStatus === 'active' ? 'billing.subscription.activated' : 'billing.subscription.checkout_confirmed'");
  });
});

describe('Stripe webhook handling', () => {
  const source = () => read('src/routes/billing.ts');

  it('verifies the real Stripe signature before trusting any event', () => {
    const s = source();
    expect(s).toContain('stripe.webhooks.constructEvent(req.body, signature, config.stripe.webhookSecret)');
    expect(s).toContain("return res.status(400).json({ error: 'INVALID_SIGNATURE' })");
  });

  it('deduplicates redelivered events by Stripe event id before applying them', () => {
    const s = source();
    // Asserted as the guarantee rather than as one exact INSERT: the statement
    // grew retry state (processing_attempts/last_error) and now upserts instead
    // of DO NOTHING, so a previously FAILED event may be retried -- but the row
    // is still keyed on Stripe's own event id, the conflict is still resolved on
    // that id, and an event that already reached processed_at still returns no
    // row and short-circuits as a duplicate rather than being applied twice.
    expect(s).toContain('INSERT INTO billing_webhook_events (id, event_type');
    expect(s).toContain('VALUES (${event.id}, ${event.type}');
    expect(s).toContain('ON CONFLICT (id) DO');
    expect(s).toContain('WHERE billing_webhook_events.processed_at IS NULL');
    expect(s).toContain('if (!webhookRow) return res.status(200).json({ received: true, duplicate: true });');
  });

  // An add-on is a separate Stripe subscription that carries the same
  // tenantId in its metadata as the plan. Keying the plan-row update on
  // tenantId alone wrote the add-on's status onto the plan: a Trust Badge
  // going past_due flipped a fully paid MSP plan to past_due and
  // enforcePaidAccess denied the entire workspace at 402.
  it('never writes an add-on subscription\'s status onto the tenant\'s plan row', () => {
    const s = source();
    const branchStart = s.indexOf("case 'customer.subscription.created':");
    const branchEnd = s.indexOf("case 'customer.subscription.deleted':");
    const branch = s.slice(branchStart, branchEnd);
    expect(branchStart).toBeGreaterThan(-1);
    // The add-on is recognised and returned on before any UPDATE runs.
    expect(branch).toContain('if (addon && ADDON_CONFIG[addon]) {');
    expect(branch.indexOf('if (addon && ADDON_CONFIG[addon]) {')).toBeLessThan(branch.indexOf('UPDATE tenant_subscriptions'));
    // The by-tenant update is reachable only for a genuine plan.
    expect(branch).toContain('tenantId && plan && PLAN_CONFIG[plan]');
  });

  it('records an add-on that was actually bought, not only one that was started', () => {
    expect(source()).toContain("action: 'billing.addon.completed'");
  });

  it('never assumes checkout completion means an active plan or add-on', () => {
    const s = source();
    expect(s).toContain('const authoritativeSubscription = await stripe.subscriptions.retrieve(subscriptionId)');
    expect(s).toContain('const authoritativeStatus = authoritativeSubscription.status');
    expect(s).toContain('const authoritativeAddon = await stripe.subscriptions.retrieve(session.subscription)');
    expect(s).toContain('status = EXCLUDED.status');
    expect(s).toContain('STRIPE_SUBSCRIPTION_TENANT_MISMATCH');
    expect(s).toContain('STRIPE_ADDON_TENANT_MISMATCH');
  });


  it('requires an active base plan before add-on checkout', () => {
    const s = source();
    const start = s.indexOf("router.post('/addon-checkout'");
    const end = s.indexOf("router.post('/portal'", start);
    const branch = s.slice(start, end);
    expect(branch).toContain("status = 'active'");
    expect(branch).toContain("code: 'SUBSCRIPTION_REQUIRED'");
    expect(branch).toContain('An active SPR plan is required before purchasing add-ons.');
  });
  it('is mounted with the raw body before the global JSON parser, not after', () => {
    const serverSource = read('server.ts');
    const webhookIndex = serverSource.indexOf("app.post('/api/billing/webhook'");
    const jsonParserIndex = serverSource.indexOf('app.use(express.json(');
    expect(webhookIndex).toBeGreaterThan(-1);
    expect(jsonParserIndex).toBeGreaterThan(-1);
    expect(webhookIndex).toBeLessThan(jsonParserIndex);
    expect(serverSource.slice(webhookIndex, webhookIndex + 200)).toContain('express.raw(');
  });
});

describe('entitlement enforcement is real, wired into the actual client-creation route, not just displayed', () => {
  it('canCreateClient independently fails closed without an active paid subscription', async () => {
    const { canCreateClient } = await import('../src/routes/billing.ts');
    const noSubscription = {
      execute: async (query: unknown) => {
        const text = JSON.stringify(query);
        if (text.includes('tenant_subscriptions')) return { rows: [] };
        if (text.includes('clients')) return { rows: [{ count: 0 }] };
        return { rows: [] };
      },
    };
    await expect(canCreateClient('tenant-unpaid', noSubscription as any)).resolves.toMatchObject({
      allowed: false,
      plan: null,
      clientLimit: null,
      clientCount: 0,
      nextPlan: null,
    });
  });

  it('propagates missing billing schema errors instead of granting access', async () => {
    const { canCreateClient } = await import('../src/routes/billing.ts');
    const missingBillingTable = {
      execute: async () => {
        const err = new Error('relation "tenant_subscriptions" does not exist');
        (err as any).code = '42P01';
        throw err;
      },
    };
    await expect(canCreateClient('tenant-missing-billing', missingBillingTable as any)).rejects.toMatchObject({ code: '42P01' });
  });

  it('POST /api/user/clients actually calls canCreateClient before inserting, and returns a structured 402 with usage/upgrade info when blocked', () => {
    const s = read('src/routes/auth.ts');
    const routeStart = s.indexOf("router.post('/user/clients'");
    const routeEnd = s.indexOf("router.get('/user/passports'");
    const routeBody = s.slice(routeStart, routeEnd);
    expect(routeBody).toContain('await canCreateClient(tenantId, db)');
    expect(routeBody).toContain("res.status(402).json({");
    expect(routeBody).toContain('currentUsage: entitlement.clientCount');
    expect(routeBody).toContain('upgradeTo: entitlement.nextPlan');
    // The entitlement check runs strictly before the INSERT, not after.
    expect(routeBody.indexOf('canCreateClient')).toBeLessThan(routeBody.indexOf('INSERT INTO clients'));
  });

  it('a limit-reached attempt is recorded to the audit trail', () => {
    const s = read('src/routes/auth.ts');
    const routeStart = s.indexOf("router.post('/user/clients'");
    const routeBody = s.slice(routeStart, routeStart + 2500);
    expect(routeBody).toContain("action: 'billing.limit.reached'");
  });

  it('a race that slips past the app-level check is still rejected by the DB trigger, not silently allowed', () => {
    const s = read('src/routes/auth.ts');
    const routeStart = s.indexOf("router.post('/user/clients'");
    const routeBody = s.slice(routeStart, routeStart + 3500);
    expect(routeBody).toContain('CLIENT_LIMIT_REACHED');
    expect(routeBody).toContain('res.status(402)');
  });
});

describe('database paywall enforcement closes route and race bypasses', () => {
  it('widens the plan CHECK constraint to the real 5-tier set', () => {
    const s = read('migrations/0043_billing_plan_tiers.sql');
    expect(s).toContain("CHECK (plan IN ('pilot', 'starter', 'professional', 'growth', 'enterprise'))");
  });

  it('uses a per-tenant advisory transaction lock, not a plain unlocked count check', () => {
    const s = read('migrations/0043_billing_plan_tiers.sql');
    expect(s).toContain('pg_advisory_xact_lock(hashtext(');
    expect(s).toContain("RAISE EXCEPTION 'CLIENT_LIMIT_REACHED'");
  });

  it('requires an active subscription before client insertion and only then permits unlimited Enterprise', () => {
    const s = read('migrations/0135_client_creation_requires_active_subscription.sql');
    expect(s).toContain("v_status IS DISTINCT FROM 'active'");
    expect(s).toContain("RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED'");
    expect(s).toContain('IF v_limit IS NULL THEN');
    expect(s).toContain('RETURN NEW;');
  });
});

describe('billing audit logging: material subscription events are recorded, not silently applied', () => {
  it('checkout initiation, activation, status changes, cancellation, and payment outcomes all append a real audit entry', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain("action: 'billing.checkout.initiated'");
    expect(s).toContain("'billing.subscription.activated'");
    expect(s).toContain("'billing.subscription.checkout_confirmed'");
    expect(s).toContain("action: 'billing.subscription.status_changed'");
    expect(s).toContain("action: 'billing.subscription.canceled'");
    expect(s).toContain("case 'invoice.paid':");
    expect(s).toContain("action: 'billing.payment.paid'");
    expect(s).toContain("action: 'billing.payment.failed'");
  });
});

describe('one-time purchases are fulfilled, not just recorded', () => {
  const source = () => read('src/routes/billing.ts');

  // Before this, checkout.session.completed for mode:'payment' wrote a single
  // audit row and stopped: the buyer heard nothing and nobody was told a sale
  // had happened. A produced deliverable needs both.
  it('queues a confirmation to the buyer and an alert to the fulfilment address', () => {
    const s = source();
    const branch = s.slice(s.indexOf("session.mode === 'payment'"), s.indexOf("session.metadata?.addon"));
    expect(branch).toContain("INSERT INTO notification_outbox");
    expect(branch).toContain("${`purchase_${event.id}_buyer`}");
    expect(branch).toContain("${`purchase_${event.id}_ops`}");
    expect(branch).toContain('config.fulfilmentEmail');
  });

  it('keys both notices on the Stripe event id so a redelivered event cannot double-send', () => {
    const s = source();
    const branch = s.slice(s.indexOf("session.mode === 'payment'"), s.indexOf("session.metadata?.addon"));
    expect((branch.match(/ON CONFLICT \(id\) DO NOTHING/g) || []).length).toBe(2);
  });

  it('never invents the fulfilment address: it is configured or the published contact address', () => {
    const c = read('src/config.ts');
    expect(c).toContain("fulfilmentEmail: parsedEnv.SPR_FULFILMENT_EMAIL ?? 'contact@softwarepassportregistry.com'");
    expect(c).toContain("{ name: 'SPR_FULFILMENT_EMAIL', category: 'featureSpecific'");
  });
});


describe('billing credential hardening', () => {
  it('rejects non-Stripe credentials before any Stripe API call', () => {
    const configSource = read('src/config.ts');
    const billingSource = read('src/routes/billing.ts');
    expect(configSource).toContain("/^(?:sk|rk)_(?:live|test)_\\S+$/");
    expect(configSource).toContain('stripeSecretKeyMisconfigured');
    expect(billingSource).toContain('stripeSecretKeyMisconfigured');
    expect(billingSource).toContain("'STRIPE_SECRET_KEY_INVALID'");
  });
});


describe('checkout state integrity', () => {
  it('does not persist an incomplete subscription before Stripe confirms payment', () => {
    const s = read('src/routes/billing.ts');
    const start = s.indexOf("router.post('/checkout'");
    const end = s.indexOf("router.post('/one-time-checkout'");
    const checkout = s.slice(start, end);
    expect(checkout).not.toContain("status = 'incomplete'");
    expect(checkout).not.toContain("'incomplete'");
    expect(checkout).toContain("action: 'billing.checkout.initiated'");
  });

  it('only presents Stripe ACTIVE as an unlocked current plan', () => {
    const s = read('src/components/BillingView.tsx');
    expect(s).toContain("const entitlementActive = subscriptionStatus === 'active'");
    expect(s).toContain('const currentPlan = entitlementActive ? status!.subscription!.plan : null;');
    expect(s).toContain('Workspace access is locked until Stripe reports this subscription as active.');
    expect(s).not.toContain("new Set(['active', 'trialing', 'past_due'])");
  });
});


describe('Stripe catalog price discovery fallback', () => {
  it('discovers only unique exact Stripe catalog matches when explicit price IDs are absent', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('discoverMissingCatalogPrices');
    expect(s).toContain("normalizeProductName(product.name) !== expected");
    expect(s).toContain('matches.length === 1');
    expect(s).toContain('Stripe price discovery is ambiguous');
  });

  it('keeps explicit environment price IDs authoritative over discovery', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('config.stripe.prices[priceKey] || discoveredPriceIds.get(priceKey)');
    expect(s).toContain('if (config.stripe.prices[target.priceKey as keyof typeof config.stripe.prices]) continue;');
  });

  it('requires one-time products to use non-recurring prices and add-ons to use recurring prices', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('target.recurring ? Boolean(price.recurring) : !price.recurring');
  });
});


describe('Manage billing visibility', () => {
  it('always renders Manage billing when billing is configured, even without an active plan', () => {
    const s = read('src/components/BillingView.tsx');
    expect(s).toContain('No active workspace subscription');
    expect(s).toContain('Manage billing');
    expect(s).toContain('subscriptionNeedsAttention');
    expect(s).toContain("apiFetch('/api/billing/portal', { method: 'POST' })");
  });
});


describe('production Stripe mode safety', () => {
  it('fails closed for server-side Stripe API checkout when a test key is present in production', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('STRIPE_TEST_MODE_IN_PRODUCTION');
    expect(s).toContain('stripeTestModeInProduction');
    expect(s).toContain('requireLiveStripeInProduction');
  });

  it('keeps configured live Payment Links available as a production recovery path', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('Boolean((config.stripe.secretKey && !productionTestMode) || hasPaymentLinkCheckout)');
    expect(s).toContain('fallback && (!stripeEntry.checkoutAvailable || productionTestMode)');
    expect(s).toContain('if (productionTestMode && !link) return { ...stripeEntry, checkoutAvailable: false }');
    expect(s).toContain("url.searchParams.set('client_reference_id', \`${tenantId}__sprplan__${parsed.data.plan}\`)");
  });

  it('keeps the Billing Portal blocked until a live Stripe API key is installed', () => {
    const s = read('src/routes/billing.ts');
    const start = s.indexOf("router.post('/portal'");
    expect(start).toBeGreaterThan(-1);
    expect(s.slice(start, start + 500)).toContain('requireLiveStripeInProduction(res)');
  });

  it('activates Payment Link purchases only from a signed completed checkout event with paid status', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('paymentLinkMatch && stripeTestModeInProduction()');
    expect(s).toContain("session.payment_status === 'paid' || session.payment_status === 'no_payment_required'");
    expect(s).toContain("? 'active'");
  });
});
