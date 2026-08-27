/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { config } from '../config.ts';
import { db } from '../db/index.ts';

// Flat monthly tiers matching the packaging already shown on MspPricingView.
// SPR never invents a dollar amount or creates Stripe Products/Prices on its
// own -- each plan is only checkout-able once its real Price ID (created in
// the Stripe Dashboard) is set as the matching env var.
export const PLAN_CLIENT_LIMITS: Record<string, number | null> = { starter: 5, growth: 25, enterprise: null };
type PlanId = keyof typeof PLAN_CLIENT_LIMITS;
const PLAN_IDS = Object.keys(PLAN_CLIENT_LIMITS) as PlanId[];

function planPriceId(plan: PlanId): string | undefined {
  return config.stripe.prices[plan];
}

function stripeClient(): Stripe {
  if (!config.stripe.secretKey) throw new Error('BILLING_NOT_CONFIGURED');
  return new Stripe(config.stripe.secretKey);
}

const checkoutSchema = z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]) }).strict();

export function createBillingRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedDb = req.db!;
      const tenantId = req.user!.tenantId;
      const subResult = await scopedDb.execute(sql`
        SELECT plan, status, client_limit AS "clientLimit", current_period_end AS "currentPeriodEnd", updated_at AS "updatedAt"
        FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1
      `);
      const clientCountResult = await scopedDb.execute(sql`SELECT count(*)::int AS count FROM clients WHERE tenant_id = ${tenantId}`);
      return res.json({
        billingConfigured: Boolean(config.stripe.secretKey),
        availablePlans: PLAN_IDS.filter((plan) => Boolean(planPriceId(plan))),
        subscription: (subResult as any).rows?.[0] ?? null,
        clientCount: (clientCountResult as any).rows?.[0]?.count ?? 0,
      });
    } catch (error) { return next(error); }
  });

  router.post('/checkout', requireAuth, requireRole(['Owner']), async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const priceId = planPriceId(parsed.data.plan);
      if (!priceId) return res.status(503).json({ error: 'This plan is not yet available for checkout.' });
      const stripe = stripeClient();
      const tenantId = req.user!.tenantId;
      const scopedDb = req.db!;
      const existing = (await scopedDb.execute(sql`SELECT stripe_customer_id AS "stripeCustomerId" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      let customerId: string | undefined = existing?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: req.user!.email, metadata: { tenantId } });
        customerId = customer.id;
        await scopedDb.execute(sql`
          INSERT INTO tenant_subscriptions (tenant_id, stripe_customer_id, plan, status)
          VALUES (${tenantId}, ${customerId}, ${parsed.data.plan}, 'incomplete')
          ON CONFLICT (tenant_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, plan = EXCLUDED.plan
        `);
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${config.appUrl}/billing?checkout=success`,
        cancel_url: `${config.appUrl}/billing?checkout=cancelled`,
        client_reference_id: tenantId,
        subscription_data: { metadata: { tenantId, plan: parsed.data.plan } },
        metadata: { tenantId, plan: parsed.data.plan },
      });
      if (!session.url) throw new Error('STRIPE_CHECKOUT_SESSION_MISSING_URL');
      return res.json({ url: session.url });
    } catch (error) { return next(error); }
  });

  router.post('/portal', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
      const scopedDb = req.db!;
      const existing = (await scopedDb.execute(sql`SELECT stripe_customer_id AS "stripeCustomerId" FROM tenant_subscriptions WHERE tenant_id = ${req.user!.tenantId} LIMIT 1`) as any).rows?.[0];
      if (!existing?.stripeCustomerId) return res.status(404).json({ error: 'NO_SUBSCRIPTION' });
      const stripe = stripeClient();
      const session = await stripe.billingPortal.sessions.create({ customer: existing.stripeCustomerId, return_url: `${config.appUrl}/billing` });
      return res.json({ url: session.url });
    } catch (error) { return next(error); }
  });

  return router;
}

// Mounted directly on `app` with express.raw() BEFORE the global
// express.json() middleware -- Stripe's signature verification needs the
// exact raw request bytes; parsing it as JSON first makes constructEvent's
// signature check always fail. No per-request tenant context exists for a
// server-to-server callback, so this uses the owner `db` connection
// directly (bypasses RLS) and scopes every write explicitly by tenant_id or
// stripe_subscription_id itself, the same pattern resolveAgentPassport uses.
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!config.stripe.webhookSecret || !config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') return res.status(400).json({ error: 'MISSING_SIGNATURE' });
  const stripe = stripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.stripe.webhookSecret);
  } catch (err) {
    console.error('[Billing] Webhook signature verification failed:', err instanceof Error ? err.message : String(err));
    return res.status(400).json({ error: 'INVALID_SIGNATURE' });
  }

  try {
    const inserted = await db.execute(sql`INSERT INTO billing_webhook_events (id, event_type) VALUES (${event.id}, ${event.type}) ON CONFLICT (id) DO NOTHING RETURNING id`);
    if (!(inserted as any).rows?.length) return res.status(200).json({ received: true, duplicate: true });
  } catch (err) {
    console.error('[Billing] Webhook idempotency check failed:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'IDEMPOTENCY_CHECK_FAILED' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id || session.metadata?.tenantId;
        const plan = session.metadata?.plan as PlanId | undefined;
        if (tenantId && session.subscription) {
          const clientLimit = plan ? PLAN_CLIENT_LIMITS[plan] ?? null : null;
          await db.execute(sql`
            UPDATE tenant_subscriptions
            SET stripe_subscription_id = ${String(session.subscription)}, plan = COALESCE(${plan ?? null}, plan),
                status = 'active', client_limit = COALESCE(${clientLimit}, client_limit), updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ${tenantId}
          `);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const currentPeriodEndSeconds = subscription.items.data[0]?.current_period_end;
        const periodEnd = currentPeriodEndSeconds ? new Date(currentPeriodEndSeconds * 1000).toISOString() : null;
        const tenantId = subscription.metadata?.tenantId;
        if (tenantId) {
          await db.execute(sql`UPDATE tenant_subscriptions SET status = ${subscription.status}, current_period_end = ${periodEnd}, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${tenantId}`);
        } else {
          await db.execute(sql`UPDATE tenant_subscriptions SET status = ${subscription.status}, current_period_end = ${periodEnd}, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await db.execute(sql`UPDATE tenant_subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id}`);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubscription = invoice.parent?.subscription_details?.subscription;
        if (invoiceSubscription) {
          const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
          await db.execute(sql`UPDATE tenant_subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscriptionId}`);
        }
        break;
      }
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Billing] Webhook event handling failed:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
  }
}

// Reusable entitlement check for any future mutation that should respect a
// tenant's plan limit (e.g. client creation, once that route exists --
// there is currently no backend route that creates a client at all, so
// nothing calls this yet; it exists so that route can gate on it from day
// one instead of shipping without enforcement).
export async function checkClientLimit(tenantId: string, scopedDb: { execute: (query: any) => Promise<any> }): Promise<{ withinLimit: boolean; clientLimit: number | null; clientCount: number }> {
  const subResult = await scopedDb.execute(sql`SELECT client_limit AS "clientLimit" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`);
  const clientLimit = (subResult as any).rows?.[0]?.clientLimit ?? null;
  const countResult = await scopedDb.execute(sql`SELECT count(*)::int AS count FROM clients WHERE tenant_id = ${tenantId}`);
  const clientCount = (countResult as any).rows?.[0]?.count ?? 0;
  return { withinLimit: clientLimit === null || clientCount < clientLimit, clientLimit, clientCount };
}
