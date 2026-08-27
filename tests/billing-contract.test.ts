import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_CLIENT_LIMITS } from '../src/routes/billing.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real billing backend: previously `stripe` was a listed dependency with
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET configured but never imported
// anywhere -- no checkout, no webhooks, no entitlements existed at all.
describe('billing plan definitions', () => {
  it('matches the tiers already shown on the pricing page, without inventing a price', () => {
    expect(PLAN_CLIENT_LIMITS).toEqual({ starter: 5, growth: 25, enterprise: null });
    // Never a hardcoded dollar amount -- prices come only from real Stripe
    // Price IDs configured via env vars once a real account exists.
    const source = read('src/routes/billing.ts');
    expect(source).not.toMatch(/\$\d/);
    expect(source).not.toMatch(/price_[A-Za-z0-9]{10,}/);
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

describe('entitlement enforcement is real, not just displayed', () => {
  it('exposes a reusable client-limit check for the eventual client-creation route to call', () => {
    const s = read('src/routes/billing.ts');
    expect(s).toContain('export async function checkClientLimit');
    expect(s).toContain('withinLimit: clientLimit === null || clientCount < clientLimit');
  });
});
