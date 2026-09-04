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
//
// No price *label* lives here either, and that is the point. Hardcoded labels
// drifted: the public pricing page advertised one set of monthly figures while
// these constants named another, and neither was necessarily what the Stripe
// Price behind the checkout button would actually charge. Every amount SPR
// displays is now read from the Stripe Price object itself (see resolvePrices),
// so a plan whose real price cannot be read is reported as having no price
// rather than being labelled with a number nobody verified.
export const PLAN_CONFIG = {
  pilot: { label: 'MSP White-Label Pilot', clientLimit: 2, priceKey: 'mspPilot' as const },
  starter: { label: 'MSP Starter', clientLimit: 5, priceKey: 'starter' as const },
  professional: { label: 'MSP Professional', clientLimit: 25, priceKey: 'professional' as const },
  growth: { label: 'MSP Business', clientLimit: 100, priceKey: 'growth' as const },
  enterprise: { label: 'Enterprise', clientLimit: null as number | null, priceKey: 'enterprise' as const },
} as const;
export type PlanId = keyof typeof PLAN_CONFIG;
const PLAN_IDS = Object.keys(PLAN_CONFIG) as PlanId[];

export const ONE_TIME_CONFIG = {
  softwarePassport: { label: 'Software Passport', priceKey: 'softwarePassport' as const },
  evidenceReport: { label: 'Evidence Report', priceKey: 'evidenceReport' as const },
  securityAssessment: { label: 'Security Assessment', priceKey: 'securityAssessment' as const },
  verifiedSystemReport: { label: 'Verified System Report', priceKey: 'verifiedSystemReport' as const },
  dueDiligenceReport: { label: 'Software Due-Diligence Report', priceKey: 'dueDiligenceReport' as const },
  vendorRiskAssessment: { label: 'Vendor Risk Assessment', priceKey: 'vendorRiskAssessment' as const },
  sbomAnalysis: { label: 'SBOM Analysis', priceKey: 'sbomAnalysis' as const },
  portfolioAssessment: { label: 'Portfolio Assessment', priceKey: 'portfolioAssessment' as const },
  auditEvidencePackage: { label: 'Audit Evidence Package', priceKey: 'auditEvidencePackage' as const },
  customAssessment: { label: 'Custom Assessment', priceKey: 'customAssessment' as const },
} as const;
export type OneTimeProductId = keyof typeof ONE_TIME_CONFIG;
const ONE_TIME_IDS = Object.keys(ONE_TIME_CONFIG) as OneTimeProductId[];

export const ADDON_CONFIG = {
  continuousVerification: { label: 'Continuous Verification', priceKey: 'continuousVerification' as const },
  trustBadge: { label: 'Trust Badge', priceKey: 'trustBadge' as const },
  publicPassport: { label: 'Public Software Passport', priceKey: 'publicPassport' as const },
  api: { label: 'SPR API', priceKey: 'api' as const },
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

// --- Real prices, read from Stripe -----------------------------------------
//
// The only honest source for "what does this cost" is the Stripe Price that
// checkout will actually charge against. Prices are read from Stripe and
// cached briefly: a catalogue read is not worth a round trip on every page
// load, but it must not go stale for long either. A lookup that fails leaves
// the previously resolved value in place rather than replacing a true price
// with a blank one, and a price that was never resolved stays null — the UI
// says the price is unavailable instead of showing a number SPR made up.
export type ResolvedPrice = { priceLabel: string; unitAmount: number; currency: string; interval: string | null };
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const resolvedPrices = new Map<string, ResolvedPrice>();
let priceCacheRefreshedAt = 0;
let priceRefreshInFlight: Promise<void> | null = null;

function describePrice(price: Stripe.Price): ResolvedPrice | null {
  // A tiered or metered Price carries no single unit_amount. There is no one
  // number to quote for it, so SPR quotes none rather than inventing one.
  if (price.unit_amount == null || !price.active) return null;
  const currency = price.currency.toUpperCase();
  const major = price.unit_amount / 100;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major);
  const recurring = price.recurring;
  const interval = recurring ? (recurring.interval_count > 1 ? `${recurring.interval_count} ${recurring.interval}s` : recurring.interval) : null;
  return { priceLabel: interval ? `${formatted}/${interval}` : formatted, unitAmount: price.unit_amount, currency: price.currency, interval };
}

async function refreshPrices(): Promise<void> {
  const stripe = stripeClient();
  const ids = [...new Set(Object.values(config.stripe.prices).filter((id): id is string => Boolean(id)))];
  await Promise.all(ids.map(async (id) => {
    try {
      const described = describePrice(await stripe.prices.retrieve(id));
      if (described) resolvedPrices.set(id, described);
      else resolvedPrices.delete(id);
    } catch (error) {
      // Keep whatever was last known good for this id; a transient Stripe
      // failure must not silently blank a price that is genuinely configured.
      console.error(`[Billing] Could not read Stripe price ${id}:`, error instanceof Error ? error.message : String(error));
    }
  }));
  priceCacheRefreshedAt = Date.now();
}

async function loadPrices(): Promise<Map<string, ResolvedPrice>> {
  if (!config.stripe.secretKey) return resolvedPrices;
  if (Date.now() - priceCacheRefreshedAt < PRICE_CACHE_TTL_MS) return resolvedPrices;
  if (!priceRefreshInFlight) {
    priceRefreshInFlight = refreshPrices().finally(() => { priceRefreshInFlight = null; });
  }
  try { await priceRefreshInFlight; } catch { /* resolvedPrices keeps its last known good contents */ }
  return resolvedPrices;
}

type CatalogEntry = {
  id: string;
  label: string;
  priceLabel: string | null;
  unitAmount: number | null;
  currency: string | null;
  interval: string | null;
  checkoutAvailable: boolean;
};

function catalogEntry(id: string, label: string, priceId: string | undefined, prices: Map<string, ResolvedPrice>): CatalogEntry {
  const price = priceId ? prices.get(priceId) ?? null : null;
  return {
    id,
    label,
    priceLabel: price?.priceLabel ?? null,
    unitAmount: price?.unitAmount ?? null,
    currency: price?.currency ?? null,
    interval: price?.interval ?? null,
    // A configured Price ID is what checkout needs; the label is what the
    // customer needs. Both must hold before anything is offered for sale, so
    // nobody is ever asked to buy at a price SPR could not state.
    checkoutAvailable: Boolean(priceId) && price !== null,
  };
}

export async function buildCatalog() {
  const prices = await loadPrices();
  return {
    billingConfigured: Boolean(config.stripe.secretKey),
    plans: PLAN_IDS.map((id) => ({
      ...catalogEntry(id, PLAN_CONFIG[id].label, planPriceId(id), prices),
      clientLimit: PLAN_CONFIG[id].clientLimit,
    })),
    products: ONE_TIME_IDS.map((id) => catalogEntry(id, ONE_TIME_CONFIG[id].label, oneTimePriceId(id), prices)),
    addons: ADDON_IDS.map((id) => catalogEntry(id, ADDON_CONFIG[id].label, addonPriceId(id), prices)),
  };
}

const checkoutSchema = z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]) }).strict();
const oneTimeCheckoutSchema = z.object({ product: z.enum(ONE_TIME_IDS as [OneTimeProductId, ...OneTimeProductId[]]) }).strict();
const addonCheckoutSchema = z.object({ addon: z.enum(ADDON_IDS as [AddonId, ...AddonId[]]) }).strict();

export function createBillingRouter() {
  const router = Router();

  // The plan/price catalogue carries no tenant data — it is the same public
  // price list the marketing pricing page shows — so it is readable without a
  // session. Serving it from the billing router keeps one catalogue behind
  // both surfaces: the price a visitor is quoted and the price the Subscribe
  // button charges can no longer be maintained separately and disagree.
  router.get('/catalog', async (_req, res, next) => {
    try { return res.json(await buildCatalog()); } catch (error) { return next(error); }
  });

  router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedDb = req.db!;
      const tenantId = req.user!.tenantId;
      const subResult = await scopedDb.execute(sql`
        SELECT plan, status, client_limit AS "clientLimit", current_period_end AS "currentPeriodEnd", updated_at AS "updatedAt"
        FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1
      `);
      const clientCountResult = await scopedDb.execute(sql`SELECT count(*)::int AS count FROM clients WHERE tenant_id = ${tenantId}`);
      const catalog = await buildCatalog();
      return res.json({
        ...catalog,
        availablePlans: catalog.plans.filter((plan) => plan.checkoutAvailable).map((plan) => plan.id),
        availableProducts: catalog.products.filter((product) => product.checkoutAvailable).map((product) => product.id),
        availableAddons: catalog.addons.filter((addon) => addon.checkoutAvailable).map((addon) => addon.id),
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
        } else if (tenantId && session.metadata?.addon) {
          // An add-on checkout completing left no trace at all: it is a
          // subscription, so it missed the plan branch above, and it is not a
          // payment, so it missed the one-time branch. Only billing.addon.initiated
          // was ever recorded, which cannot distinguish an add-on somebody
          // bought from one they abandoned at the Stripe page.
          await appendAuditEntry(db, { tenantId, action: 'billing.addon.completed', actor: 'stripe-webhook', payload: { addon: session.metadata.addon, stripeEventId: event.id, checkoutSessionId: session.id, stripeSubscriptionId: session.subscription ? String(session.subscription) : null } });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const currentPeriodEndSeconds = subscription.items.data[0]?.current_period_end;
        const periodEnd = currentPeriodEndSeconds ? new Date(currentPeriodEndSeconds * 1000).toISOString() : null;
        const tenantId = subscription.metadata?.tenantId;
        const addon = subscription.metadata?.addon as AddonId | undefined;
        // An add-on is its own Stripe subscription, and it carries the same
        // tenantId in its metadata as the plan does. Matching on tenantId
        // alone therefore wrote the ADD-ON's status onto the tenant's PLAN
        // row: a Trust Badge going past_due or cancelled flipped a fully paid
        // MSP plan to past_due/canceled and enforcePaidAccess started denying
        // the whole workspace, while an active add-on could equally mask a
        // plan that had genuinely lapsed. The plan row is only ever written
        // for a subscription that is actually a plan.
        if (addon && ADDON_CONFIG[addon]) {
          if (tenantId) await appendAuditEntry(db, { tenantId, action: 'billing.addon.status_changed', actor: 'stripe-webhook', payload: { addon, status: subscription.status, stripeEventId: event.id, stripeSubscriptionId: subscription.id } });
          break;
        }
        const plan = subscription.metadata?.plan as PlanId | undefined;
        const updated = tenantId && plan && PLAN_CONFIG[plan]
          ? (await db.execute(sql`UPDATE tenant_subscriptions SET status = ${subscription.status}, current_period_end = ${periodEnd}, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${tenantId} RETURNING tenant_id`) as any).rows?.[0]
          // No plan in the metadata: fall back to the subscription id, which
          // matches the plan row and nothing else.
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
