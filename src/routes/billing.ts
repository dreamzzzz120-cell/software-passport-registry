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
import { appendAuditEntry } from '../security/audit-log.ts';

// Subscription plans are mapped only to real Stripe Price IDs supplied by
// deployment configuration. SPR never invents prices or creates Stripe
// Products/Prices at runtime.
export const PLAN_CONFIG = {
  pilot: { label: 'MSP White-Label Pilot', priceLabel: '$500/month', clientLimit: 2, priceKey: 'mspPilot' as const },
  starter: { label: 'MSP Starter', priceLabel: '$499/month', clientLimit: 10, priceKey: 'starter' as const },
  professional: { label: 'MSP Growth', priceLabel: '$1,000/month', clientLimit: 50, priceKey: 'mspGrowth' as const },
  growth: { label: 'MSP Scale', priceLabel: '$2,500/month', clientLimit: 150, priceKey: 'mspScale' as const },
  enterprise: { label: 'Enterprise', priceLabel: '$5,000+/month (custom)', clientLimit: null as number | null, priceKey: 'enterprise' as const },
} as const;
export type PlanId = keyof typeof PLAN_CONFIG;
const PLAN_IDS = Object.keys(PLAN_CONFIG) as PlanId[];

export const ONE_TIME_CONFIG = {
  softwarePassport: { label: 'Software Passport', priceLabel: '$49', priceKey: 'softwarePassport' as const },
  evidenceReport: { label: 'Evidence Report', priceLabel: '$99', priceKey: 'evidenceReport' as const },
  securityAssessment: { label: 'Security Assessment', priceLabel: '$199', priceKey: 'securityAssessment' as const },
  verifiedSystemReport: { label: 'Verified System Report', priceLabel: '$499', priceKey: 'verifiedSystemReport' as const },
  dueDiligenceReport: { label: 'Software Due-Diligence Report', priceLabel: '$799', priceKey: 'dueDiligenceReport' as const },
  vendorRiskAssessment: { label: 'Vendor Risk Assessment', priceLabel: '$999', priceKey: 'vendorRiskAssessment' as const },
  sbomAnalysis: { label: 'SBOM Analysis', priceLabel: '$199', priceKey: 'sbomAnalysis' as const },
  portfolioAssessment: { label: 'Portfolio Assessment', priceLabel: '$1,499', priceKey: 'portfolioAssessment' as const },
  auditEvidencePackage: { label: 'Audit Evidence Package', priceLabel: '$999', priceKey: 'auditEvidencePackage' as const },
  customAssessment: { label: 'Custom Assessment', priceLabel: '$1,500', priceKey: 'customAssessment' as const },
} as const;
export type OneTimeProductId = keyof typeof ONE_TIME_CONFIG;
const ONE_TIME_IDS = Object.keys(ONE_TIME_CONFIG) as OneTimeProductId[];

export const ADDON_CONFIG = {
  continuousVerification: { label: 'Continuous Verification', priceLabel: '$149/month', priceKey: 'continuousVerification' as const },
  trustBadge: { label: 'Trust Badge', priceLabel: '$49/month', priceKey: 'trustBadge' as const },
  publicPassport: { label: 'Public Software Passport', priceLabel: '$49/month', priceKey: 'publicPassport' as const },
  api: { label: 'SPR API', priceLabel: '$199/month', priceKey: 'api' as const },
} as const;
export type AddonId = keyof typeof ADDON_CONFIG;
const ADDON_IDS = Object.keys(ADDON_CONFIG) as AddonId[];

export const PLAN_CLIENT_LIMITS: Record<PlanId, number | null> = Object.fromEntries(
  PLAN_IDS.map((id) => [id, PLAN_CONFIG[id].clientLimit]),
) as Record<PlanId, number | null>;

function planPriceId(plan: PlanId): string | undefined {
  return config.stripe.prices[PLAN_CONFIG[plan].priceKey as keyof typeof config.stripe.prices];
}

function oneTimePriceId(product: OneTimeProductId): string | undefined {
  return config.stripe.prices[ONE_TIME_CONFIG[product].priceKey as keyof typeof config.stripe.prices];
}

function addonPriceId(addon: AddonId): string | undefined {
  return config.stripe.prices[ADDON_CONFIG[addon].priceKey as keyof typeof config.stripe.prices];
}

export async function getPlanLimits(tenantId: string, scopedDb: { execute: (query: any) => Promise<any> }): Promise<{ plan: PlanId | null; clientLimit: number | null }> {
  const subResult = await scopedDb.execute(sql`SELECT plan, client_limit AS "clientLimit" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`);
  const row = (subResult as any).rows?.[0];
  return { plan: row?.plan ?? null, clientLimit: row?.clientLimit ?? null };
}

function stripeClient(): Stripe {
  if (!config.stripe.secretKey) throw new Error('BILLING_NOT_CONFIGURED');
  return new Stripe(config.stripe.secretKey);
}

const checkoutSchema = z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]) }).strict();
const oneTimeCheckoutSchema = z.object({ product: z.enum(ONE_TIME_IDS as [OneTimeProductId, ...OneTimeProductId[]]) }).strict();
const addonCheckoutSchema = z.object({ addon: z.enum(ADDON_IDS as [AddonId, ...AddonId[]]) }).strict();

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
        plans: PLAN_IDS.map((id) => ({ id, ...PLAN_CONFIG[id], checkoutAvailable: Boolean(planPriceId(id)) })),
        availablePlans: PLAN_IDS.filter((plan) => Boolean(planPriceId(plan))),
        products: ONE_TIME_IDS.map((id) => ({ id, ...ONE_TIME_CONFIG[id], checkoutAvailable: Boolean(oneTimePriceId(id)) })),
        availableProducts: ONE_TIME_IDS.filter((id) => Boolean(oneTimePriceId(id))),
        addons: ADDON_IDS.map((id) => ({ id, ...ADDON_CONFIG[id], checkoutAvailable: Boolean(addonPriceId(id)) })),
        availableAddons: ADDON_IDS.filter((id) => Boolean(addonPriceId(id))),
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
      const customerId: string | undefined = existing?.stripeCustomerId;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        ...(customerId ? { customer: customerId } : { customer_email: req.user!.email }),
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${config.appUrl}/billing?checkout=success`,
        cancel_url: `${config.appUrl}/billing?checkout=cancelled`,
        client_reference_id: tenantId,
        subscription_data: { metadata: { tenantId, plan: parsed.data.plan } },
        metadata: { tenantId, plan: parsed.data.plan },
      });
      if (!session.url) throw new Error('STRIPE_CHECKOUT_SESSION_MISSING_URL');
      await scopedDb.execute(sql`
        INSERT INTO tenant_subscriptions (tenant_id, stripe_customer_id, plan, status)
        VALUES (${tenantId}, ${customerId ?? null}, ${parsed.data.plan}, 'incomplete')
        ON CONFLICT (tenant_id) DO UPDATE SET
          stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, tenant_subscriptions.stripe_customer_id),
          plan = EXCLUDED.plan,
          status = 'incomplete',
          updated_at = CURRENT_TIMESTAMP
      `);
      await appendAuditEntry(scopedDb, { tenantId, action: 'billing.checkout.initiated', actor: req.user!.uid, payload: { plan: parsed.data.plan, checkoutSessionId: session.id } });
      return res.json({ url: session.url });
    } catch (error) { return next(error); }
  });

  router.post('/one-time-checkout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
      const parsed = oneTimeCheckoutSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const priceId = oneTimePriceId(parsed.data.product);
      if (!priceId) return res.status(503).json({ error: 'This product is not yet available for checkout.' });
      const tenantId = req.user!.tenantId;
      const stripe = stripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: req.user!.email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${config.appUrl}/billing?purchase=success&product=${encodeURIComponent(parsed.data.product)}`,
        cancel_url: `${config.appUrl}/billing?purchase=cancelled`,
        client_reference_id: tenantId,
        metadata: { tenantId, product: parsed.data.product },
      });
      if (!session.url) throw new Error('STRIPE_CHECKOUT_SESSION_MISSING_URL');
      await appendAuditEntry(req.db!, { tenantId, action: 'billing.purchase.initiated', actor: req.user!.uid, payload: { product: parsed.data.product, checkoutSessionId: session.id } });
      return res.json({ url: session.url });
    } catch (error) { return next(error); }
  });

  router.post('/addon-checkout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
      const parsed = addonCheckoutSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const priceId = addonPriceId(parsed.data.addon);
      if (!priceId) return res.status(503).json({ error: 'This add-on is not yet available for checkout.' });
      const tenantId = req.user!.tenantId;
      const stripe = stripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: req.user!.email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${config.appUrl}/billing?addon=success&addon=${encodeURIComponent(parsed.data.addon)}`,
        cancel_url: `${config.appUrl}/billing?addon=cancelled`,
        client_reference_id: tenantId,
        subscription_data: { metadata: { tenantId, addon: parsed.data.addon } },
        metadata: { tenantId, addon: parsed.data.addon },
      });
      if (!session.url) throw new Error('STRIPE_CHECKOUT_SESSION_MISSING_URL');
      await appendAuditEntry(req.db!, { tenantId, action: 'billing.addon.initiated', actor: req.user!.uid, payload: { addon: parsed.data.addon, checkoutSessionId: session.id } });
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
        if (tenantId && session.subscription && plan && PLAN_CONFIG[plan]) {
          const clientLimit = PLAN_CLIENT_LIMITS[plan];
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
          await db.execute(sql`
            UPDATE tenant_subscriptions
            SET stripe_customer_id = COALESCE(${customerId ?? null}, stripe_customer_id),
                stripe_subscription_id = ${String(session.subscription)}, plan = ${plan},
                status = 'active', client_limit = ${clientLimit}, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ${tenantId}
          `);
          await appendAuditEntry(db, { tenantId, action: 'billing.subscription.activated', actor: 'stripe-webhook', payload: { plan, stripeEventId: event.id, stripeSubscriptionId: String(session.subscription), stripeCustomerId: customerId ?? null } });
        } else if (tenantId && session.mode === 'payment') {
          await appendAuditEntry(db, { tenantId, action: 'billing.purchase.completed', actor: 'stripe-webhook', payload: { product: session.metadata?.product ?? null, stripeEventId: event.id, checkoutSessionId: session.id } });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const currentPeriodEndSeconds = subscription.items.data[0]?.current_period_end;
        const periodEnd = currentPeriodEndSeconds ? new Date(currentPeriodEndSeconds * 1000).toISOString() : null;
        const tenantId = subscription.metadata?.tenantId;
        const updated = tenantId
          ? (await db.execute(sql`UPDATE tenant_subscriptions SET status = ${subscription.status}, current_period_end = ${periodEnd}, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${tenantId} RETURNING tenant_id`) as any).rows?.[0]
          : (await db.execute(sql`UPDATE tenant_subscriptions SET status = ${subscription.status}, current_period_end = ${periodEnd}, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id} RETURNING tenant_id`) as any).rows?.[0];
        if (updated?.tenant_id) await appendAuditEntry(db, { tenantId: updated.tenant_id, action: 'billing.subscription.status_changed', actor: 'stripe-webhook', payload: { status: subscription.status, stripeEventId: event.id } });
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const canceled = (await db.execute(sql`UPDATE tenant_subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id} RETURNING tenant_id`) as any).rows?.[0];
        if (canceled?.tenant_id) await appendAuditEntry(db, { tenantId: canceled.tenant_id, action: 'billing.subscription.canceled', actor: 'stripe-webhook', payload: { stripeEventId: event.id } });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubscription = invoice.parent?.subscription_details?.subscription;
        if (invoiceSubscription) {
          const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
          const pastDue = (await db.execute(sql`UPDATE tenant_subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscriptionId} RETURNING tenant_id`) as any).rows?.[0];
          if (pastDue?.tenant_id) await appendAuditEntry(db, { tenantId: pastDue.tenant_id, action: 'billing.payment.failed', actor: 'stripe-webhook', payload: { stripeEventId: event.id } });
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

export async function canCreateClient(tenantId: string, scopedDb: { execute: (query: any) => Promise<any> }): Promise<{
  allowed: boolean; plan: PlanId | null; clientLimit: number | null; clientCount: number; nextPlan: PlanId | null;
}> {
  const { plan, clientLimit } = await getPlanLimits(tenantId, scopedDb);
  const countResult = await scopedDb.execute(sql`SELECT count(*)::int AS count FROM clients WHERE tenant_id = ${tenantId}`);
  const clientCount = (countResult as any).rows?.[0]?.count ?? 0;
  const allowed = clientLimit === null || clientCount < clientLimit;
  const currentIndex = plan ? PLAN_IDS.indexOf(plan) : -1;
  const nextPlan = currentIndex >= 0 && currentIndex < PLAN_IDS.length - 1 ? PLAN_IDS[currentIndex + 1] : null;
  return { allowed, plan, clientLimit, clientCount, nextPlan };
}
