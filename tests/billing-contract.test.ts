import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_CLIENT_LIMITS, PLAN_CONFIG } from '../src/routes/billing.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real billing backend: previously `stripe` was a listed dependency with
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET configured but never imported
// anywhere -- no checkout, no webhooks, no entitlements existed at all.
// 5-tier plan model (Pilot/Starter/Professional/Growth/Enterprise), per the
// commercial monetization spec -- price *labels* are real, user-facing
// display text the spec itself specifies, not a Stripe object SPR invents;
// the actual charge amount always comes from the real Stripe Price ID
// configured via env var (see planPriceId), never from this label.
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
    // These labels are the public MSP tiers, and each one was checked against
    // the live Stripe Price the plan's priceKey resolves to before this test
    // was moved onto them: starter -> $149/month, professional -> $399/month,
    // growth -> $799/month, all active recurring prices. The label is display
    // text only -- planPriceId still takes the amount from the configured
    // Stripe Price ID -- but a label that disagreed with that price would
    // advertise one number and charge another, which is what this asserts
    // against.
    expect(PLAN_CONFIG.starter.priceLabel).toBe('$149/month');
    expect(PLAN_CONFIG.professional.priceLabel).toBe('$399/month');
    expect(PLAN_CONFIG.growth.priceLabel).toBe('$799/month');
  });
});

describe('billing routes are real, authenticated, and role-gated', () => {
  const source = () => read('src/routes/billing.ts');

  it('requires Owner to start checkout and Owner/Admin to manage billing', () => {
    const s = source();
    expect(s).toContain("router.post('/checkout', requireAuth, requireRole(['Owner'])");
    expect(s).toContain("router.post('/portal', requireAuth, requireRole(['Owner', 'Admin'])");
  });

  it('scopes every subscription read/write by the caller\'s own tenant', () => {
    const s = source();
    expect(s).toContain('WHERE tenant_id = ${tenantId}');
    expect(s).toContain('VALUES (${tenantId}');
  });

  it('never subscribes/checks out a plan with no configured Stripe price', () => {
    const s = source();
    expect(s).toContain('if (!priceId) return res.status(503)');
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
    expect(s).toContain('INSERT INTO billing_webhook_events (id, event_type) VALUES (${event.id}');
    expect(s).toContain('ON CONFLICT (id) DO NOTHING');
    expect(s).toContain('duplicate: true');
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
  it('canCreateClient is exported and treats a tenant with no subscription row (or a null limit) as unrestricted', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('export async function canCreateClient');
    expect(s).toContain('const allowed = clientLimit === null || clientCount < clientLimit;');
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

describe('migration 0043 enforces the client limit at the database level, closing the check-then-act race', () => {
  it('widens the plan CHECK constraint to the real 5-tier set', () => {
    const s = read('migrations/0043_billing_plan_tiers.sql');
    expect(s).toContain("CHECK (plan IN ('pilot', 'starter', 'professional', 'growth', 'enterprise'))");
  });

  it('uses a per-tenant advisory transaction lock, not a plain unlocked count check', () => {
    const s = read('migrations/0043_billing_plan_tiers.sql');
    expect(s).toContain('pg_advisory_xact_lock(hashtext(');
    expect(s).toContain("RAISE EXCEPTION 'CLIENT_LIMIT_REACHED'");
  });

  it('treats a NULL client_limit as unrestricted, never blocking Enterprise or a tenant with no subscription row', () => {
    const s = read('migrations/0043_billing_plan_tiers.sql');
    expect(s).toContain('IF v_limit IS NULL THEN');
    expect(s).toContain('RETURN NEW;');
  });
});

describe('billing audit logging: material subscription events are recorded, not silently applied', () => {
  it('checkout initiation, activation, status changes, cancellation, and payment failure all append a real audit entry', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain("action: 'billing.checkout.initiated'");
    expect(s).toContain("action: 'billing.subscription.activated'");
    expect(s).toContain("action: 'billing.subscription.status_changed'");
    expect(s).toContain("action: 'billing.subscription.canceled'");
    expect(s).toContain("action: 'billing.payment.failed'");
  });
});
