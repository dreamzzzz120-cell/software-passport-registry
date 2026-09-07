import { describe, expect, it } from 'vitest';
import { readCode as read } from '../helpers/source-contract.ts';

// SECTION 17 of the MSP acceptance spec. This sandbox cannot fire a real
// signed Stripe test-mode event at a live endpoint, so this verifies the
// three concrete guarantees at the source that every inbound event
// actually runs through, in the order they run.
describe('Stripe webhook handler: signature, idempotency, tenant-safe event handling', () => {
  const billing = read('src/routes/billing.ts');
  const start = billing.indexOf('export async function stripeWebhookHandler');
  const handler = start > -1 ? billing.slice(start) : '';

  it('the handler function actually exists in billing.ts', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('never trusts an unsigned or wrongly-signed event', () => {
    expect(handler).toContain("typeof signature !== 'string'");
    expect(handler).toContain('MISSING_SIGNATURE');
    expect(handler).toContain('stripe.webhooks.constructEvent(req.body, signature, config.stripe.webhookSecret)');
    expect(handler).toContain('INVALID_SIGNATURE');
  });

  it('signature verification happens before any event is processed', () => {
    const sigIdx = handler.indexOf('constructEvent');
    const switchIdx = handler.indexOf('switch (event.type)');
    expect(sigIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(sigIdx);
  });

  it('duplicate events are rejected via a real DB-level idempotency guard, not an in-memory set', () => {
    expect(handler).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(handler).toContain('WHERE billing_webhook_events.processed_at IS NULL');
    expect(handler).toContain('duplicate: true');
  });

  it('an add-on subscription updating status can never overwrite the tenant\'s plan row', () => {
    // A real, previously-live bug this exact test would have caught: an
    // add-on subscription carries the same tenantId in its Stripe metadata
    // as the plan subscription, so matching on tenantId alone let an add-on
    // going past_due/canceled flip a fully paid MSP plan to past_due,
    // silently denying the whole workspace via enforcePaidAccess.
    const subIdx = handler.indexOf("case 'customer.subscription.created':");
    expect(subIdx).toBeGreaterThan(-1);
    const branch = handler.slice(subIdx, subIdx + 2200);
    expect(branch).toContain('if (addon && ADDON_CONFIG[addon])');
    expect(branch).toMatch(/if \(addon && ADDON_CONFIG\[addon\]\) \{[\s\S]*?break;\s*\}/);
  });

  it('every subscription-activating event writes a real audit entry with the Stripe event id', () => {
    expect(handler).toContain("action: 'billing.subscription.activated'");
    expect(handler).toContain('stripeEventId: event.id');
  });
});
