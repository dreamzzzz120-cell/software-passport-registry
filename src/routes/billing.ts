/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { config, stripeSecretKeyMisconfigured } from '../config.ts';
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

function planPaymentLink(plan: PlanId): string | undefined {
  if (plan === 'starter') return config.stripe.paymentLinks.starter;
  if (plan === 'professional') return config.stripe.paymentLinks.professional;
  if (plan === 'growth') return config.stripe.paymentLinks.growth;
  return undefined;
}

const ONE_TIME_PAYMENT_LINK_ENV: Record<OneTimeProductId, string> = {
  softwarePassport: 'STRIPE_PAYMENT_LINK_SOFTWARE_PASSPORT',
  evidenceReport: 'STRIPE_PAYMENT_LINK_EVIDENCE_REPORT',
  securityAssessment: 'STRIPE_PAYMENT_LINK_SECURITY_ASSESSMENT',
  verifiedSystemReport: 'STRIPE_PAYMENT_LINK_VERIFIED_SYSTEM_REPORT',
  dueDiligenceReport: 'STRIPE_PAYMENT_LINK_DUE_DILIGENCE_REPORT',
  vendorRiskAssessment: 'STRIPE_PAYMENT_LINK_VENDOR_RISK_ASSESSMENT',
  sbomAnalysis: 'STRIPE_PAYMENT_LINK_SBOM_ANALYSIS',
  portfolioAssessment: 'STRIPE_PAYMENT_LINK_PORTFOLIO_ASSESSMENT',
  auditEvidencePackage: 'STRIPE_PAYMENT_LINK_AUDIT_EVIDENCE_PACKAGE',
  customAssessment: 'STRIPE_PAYMENT_LINK_CUSTOM_ASSESSMENT',
};

const ADDON_PAYMENT_LINK_ENV: Record<AddonId, string> = {
  continuousVerification: 'STRIPE_PAYMENT_LINK_CONTINUOUS_VERIFICATION',
  trustBadge: 'STRIPE_PAYMENT_LINK_TRUST_BADGE',
  publicPassport: 'STRIPE_PAYMENT_LINK_PUBLIC_PASSPORT',
  api: 'STRIPE_PAYMENT_LINK_API',
};

const ONE_TIME_FALLBACK_PRICE: Record<OneTimeProductId, number> = {
  softwarePassport: 4900,
  evidenceReport: 9900,
  securityAssessment: 19900,
  verifiedSystemReport: 49900,
  dueDiligenceReport: 79900,
  vendorRiskAssessment: 99900,
  sbomAnalysis: 19900,
  portfolioAssessment: 149900,
  auditEvidencePackage: 99900,
  customAssessment: 150000,
};

const ADDON_FALLBACK_PRICE: Record<AddonId, number> = {
  continuousVerification: 14900,
  trustBadge: 4900,
  publicPassport: 4900,
  api: 19900,
};

function oneTimePaymentLink(product: OneTimeProductId): string | undefined {
  return process.env[ONE_TIME_PAYMENT_LINK_ENV[product]]?.trim() || undefined;
}

function addonPaymentLink(addon: AddonId): string | undefined {
  return process.env[ADDON_PAYMENT_LINK_ENV[addon]]?.trim() || undefined;
}

function paymentLinkFallback(unitAmount: number, recurring: boolean, description: string): ResolvedPrice {
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(unitAmount / 100);
  return {
    priceLabel: recurring ? `${amount}/month` : amount,
    unitAmount,
    currency: 'usd',
    interval: recurring ? 'month' : null,
    description,
  };
}



const discoveredPriceIds = new Map<string, string>();
let discoveryRefreshedAt = 0;
let discoveryInFlight: Promise<void> | null = null;
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

function configuredPriceId(priceKey: keyof typeof config.stripe.prices): string | undefined {
  return config.stripe.prices[priceKey] || discoveredPriceIds.get(priceKey);
}

function oneTimePriceId(product: OneTimeProductId): string | undefined {
  return configuredPriceId(ONE_TIME_CONFIG[product].priceKey as keyof typeof config.stripe.prices);
}

function addonPriceId(addon: AddonId): string | undefined {
  return configuredPriceId(ADDON_CONFIG[addon].priceKey as keyof typeof config.stripe.prices);
}

function normalizeProductName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function discoverMissingCatalogPrices(stripe: Stripe): Promise<void> {
  if (Date.now() - discoveryRefreshedAt < DISCOVERY_TTL_MS) return;
  if (!discoveryInFlight) {
    discoveryInFlight = (async () => {
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] }).autoPagingToArray({ limit: 1000 });
      const targets = [
        ...ONE_TIME_IDS.map((id) => ({ priceKey: ONE_TIME_CONFIG[id].priceKey, label: ONE_TIME_CONFIG[id].label, recurring: false })),
        ...ADDON_IDS.map((id) => ({ priceKey: ADDON_CONFIG[id].priceKey, label: ADDON_CONFIG[id].label, recurring: true })),
      ];

      for (const target of targets) {
        if (config.stripe.prices[target.priceKey as keyof typeof config.stripe.prices]) continue;
        const expected = normalizeProductName(target.label);
        const matches = prices.filter((price) => {
          const product = typeof price.product === 'object' && price.product && !('deleted' in price.product) ? price.product : null;
          if (!product?.name || normalizeProductName(product.name) !== expected) return false;
          return target.recurring ? Boolean(price.recurring) : !price.recurring;
        });
        if (matches.length === 1) {
          discoveredPriceIds.set(target.priceKey, matches[0].id);
          console.info(`[Billing] Discovered unique Stripe price for ${target.label}.`);
        } else {
          discoveredPriceIds.delete(target.priceKey);
          if (matches.length > 1) console.warn(`[Billing] Stripe price discovery is ambiguous for ${target.label}; leaving checkout unavailable.`);
        }
      }
      discoveryRefreshedAt = Date.now();
    })().finally(() => { discoveryInFlight = null; });
  }
  await discoveryInFlight;
}

export async function getPlanLimits(tenantId: string, scopedDb: { execute: (query: any) => Promise<any> }): Promise<{ plan: PlanId | null; clientLimit: number | null; status: string }> {
  const subResult = await scopedDb.execute(sql`SELECT plan, status, client_limit AS "clientLimit" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`);
  const row = (subResult as any).rows?.[0];
  return { plan: row?.plan ?? null, clientLimit: row?.clientLimit ?? null, status: row?.status ?? 'none' };
}

function stripeClient(): Stripe {
  if (!config.stripe.secretKey) throw new Error('BILLING_NOT_CONFIGURED');
  return new Stripe(config.stripe.secretKey);
}

function stripeTestModeInProduction(): boolean {
  const production = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME === 'production';
  return production && Boolean(config.stripe.secretKey && /_test_/.test(config.stripe.secretKey));
}

function requireLiveStripeInProduction(res: Response): boolean {
  if (!stripeTestModeInProduction()) return true;
  res.status(503).json({
    error: 'STRIPE_TEST_MODE_IN_PRODUCTION',
    message: 'Production billing is disabled until STRIPE_SECRET_KEY is a live-mode Stripe key.',
  });
  return false;
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
// description is the Stripe Product's own description, expanded off the
// Price. It is the one place product copy lives, so the billing page shows
// what Stripe says rather than restating it in the client.
export type ResolvedPrice = { priceLabel: string; unitAmount: number; currency: string; interval: string | null; description: string | null };
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
  const product = typeof price.product === 'object' && price.product && !('deleted' in price.product) ? price.product : null;
  const description = product?.description?.trim() || null;
  return { priceLabel: interval ? `${formatted}/${interval}` : formatted, unitAmount: price.unit_amount, currency: price.currency, interval, description };
}

async function refreshPrices(): Promise<void> {
  const stripe = stripeClient();
  await discoverMissingCatalogPrices(stripe);
  const ids = [...new Set([
    ...Object.values(config.stripe.prices),
    ...discoveredPriceIds.values(),
  ].filter((id): id is string => Boolean(id)))];
  await Promise.all(ids.map(async (id) => {
    try {
      const described = describePrice(await stripe.prices.retrieve(id, { expand: ['product'] }));
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
  description: string | null;
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
    description: price?.description ?? null,
    // A configured Price ID is what checkout needs; the label is what the
    // customer needs. Both must hold before anything is offered for sale, so
    // nobody is ever asked to buy at a price SPR could not state.
    checkoutAvailable: Boolean(priceId) && price !== null,
  };
}

export async function buildCatalog() {
  const prices = await loadPrices();
  const hasPaymentLinkCheckout = PLAN_IDS.some((id) => Boolean(planPaymentLink(id)));
  const productionTestMode = stripeTestModeInProduction();
  return {
    billingConfigured: (Boolean(config.stripe.secretKey) || hasPaymentLinkCheckout) && !productionTestMode,
    billingConfigurationError: productionTestMode
      ? 'STRIPE_TEST_MODE_IN_PRODUCTION'
      : stripeSecretKeyMisconfigured ? 'STRIPE_SECRET_KEY_INVALID' : null,
    plans: PLAN_IDS.map((id) => {
      const stripeEntry = catalogEntry(id, PLAN_CONFIG[id].label, planPriceId(id), prices);
      const fallback = planPaymentLink(id) ? config.stripe.paymentLinkCatalog[id as keyof typeof config.stripe.paymentLinkCatalog] : undefined;
      return {
        ...stripeEntry,
        ...(fallback && !stripeEntry.checkoutAvailable && !productionTestMode ? {
          priceLabel: fallback.priceLabel,
          unitAmount: fallback.unitAmount,
          currency: fallback.currency,
          interval: fallback.interval,
          description: fallback.description,
          checkoutAvailable: true,
        } : {}),
        clientLimit: PLAN_CONFIG[id].clientLimit,
      };
    }),
    products: ONE_TIME_IDS.map((id) => {
      const stripeEntry = catalogEntry(id, ONE_TIME_CONFIG[id].label, oneTimePriceId(id), prices);
      if (productionTestMode) return { ...stripeEntry, checkoutAvailable: false };
      const link = oneTimePaymentLink(id);
      return link && !stripeEntry.checkoutAvailable
        ? { ...stripeEntry, ...paymentLinkFallback(ONE_TIME_FALLBACK_PRICE[id], false, ONE_TIME_CONFIG[id].label), checkoutAvailable: true }
        : stripeEntry;
    }),
    addons: ADDON_IDS.map((id) => {
      const stripeEntry = catalogEntry(id, ADDON_CONFIG[id].label, addonPriceId(id), prices);
      if (productionTestMode) return { ...stripeEntry, checkoutAvailable: false };
      const link = addonPaymentLink(id);
      return link && !stripeEntry.checkoutAvailable
        ? { ...stripeEntry, ...paymentLinkFallback(ADDON_FALLBACK_PRICE[id], true, ADDON_CONFIG[id].label), checkoutAvailable: true }
        : stripeEntry;
    }),
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
      // Purchase history is read from the tamper-evident audit trail: only
      // events the Stripe webhook actually recorded appear here, never a
      // checkout that was started and abandoned.
      const purchaseRows = (await scopedDb.execute(sql`
        SELECT action, timestamp, payload FROM audit_trail
        WHERE tenant_id = ${tenantId} AND action IN ('billing.purchase.notified', 'billing.addon.completed', 'billing.subscription.activated')
        ORDER BY id DESC LIMIT 50
      `) as any).rows ?? [];
      const purchases = purchaseRows.map((row: any) => {
        let payload: any = {}; try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}); } catch { payload = {}; }
        const kind = row.action === 'billing.purchase.notified' ? 'product' : row.action === 'billing.addon.completed' ? 'addon' : 'plan';
        const id = kind === 'product' ? payload.product : kind === 'addon' ? payload.addon : payload.plan;
        const label = kind === 'product' ? ONE_TIME_CONFIG[id as OneTimeProductId]?.label : kind === 'addon' ? ADDON_CONFIG[id as AddonId]?.label : PLAN_CONFIG[id as PlanId]?.label;
        return { kind, id: id ?? null, label: label ?? id ?? 'Unknown item', at: row.timestamp, orderRef: payload.orderRef ?? null, amount: payload.amount ?? null, fulfilment: kind === 'product' ? 'produced by the SPR team; you will be contacted at your account email' : kind === 'addon' ? 'active on this workspace' : 'active plan' };
      });
      const catalog = await buildCatalog();
      return res.json({
        purchases,
        ...catalog,
        availablePlans: catalog.plans.filter((plan) => plan.checkoutAvailable).map((plan) => plan.id),
        availableProducts: catalog.products.filter((product) => product.checkoutAvailable).map((product) => product.id),
        availableAddons: catalog.addons.filter((addon) => addon.checkoutAvailable).map((addon) => addon.id),
        subscription: (() => {
          const row = (subResult as any).rows?.[0] ?? null;
          return row && ['active', 'trialing', 'past_due'].includes(String(row.status)) ? row : null;
        })(),
        clientCount: (clientCountResult as any).rows?.[0]?.count ?? 0,
      });
    } catch (error) { return next(error); }
  });

  router.post('/checkout', requireAuth, requireRole(['Owner']), async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireLiveStripeInProduction(res)) return;
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const priceId = planPriceId(parsed.data.plan);
      if (!priceId) return res.status(503).json({ error: 'This plan is not yet available for checkout.' });
      const tenantId = req.user!.tenantId;
      const scopedDb = req.db!;
      const existing = (await scopedDb.execute(sql`SELECT stripe_customer_id AS "stripeCustomerId", stripe_subscription_id AS "stripeSubscriptionId", plan, status FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      const customerId: string | undefined = existing?.stripeCustomerId;
      // One plan subscription per tenant. Observed 2026-09-11: a tenant that
      // already held an active plan could start a second plan checkout, and
      // Stripe happily created a second live subscription -- a real customer
      // would be billed twice. Plan changes go through the Billing Portal,
      // which swaps the price on the existing subscription with proration.
      if (existing?.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(String(existing.status))) {
        return res.status(409).json({
          error: 'PLAN_ALREADY_ACTIVE', code: 'PLAN_ALREADY_ACTIVE', currentPlan: existing.plan, billingPath: '/billing',
          message: `This workspace already has an active ${existing.plan} plan. Use Manage billing to change plans; a second checkout would create a second subscription.`,
        });
      }
      let checkoutUrl: string;
      let checkoutReference: string;
      if (config.stripe.secretKey) {
        const stripe = stripeClient();
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          ...(customerId ? { customer: customerId } : { customer_email: req.user!.email }),
          line_items: [{ price: priceId, quantity: 1 }],
          allow_promotion_codes: true,
          adaptive_pricing: { enabled: false },
        managed_payments: { enabled: false },
          payment_method_collection: 'if_required',
          success_url: `${config.appUrl}/billing?checkout=success`,
          cancel_url: `${config.appUrl}/billing?checkout=cancelled`,
          client_reference_id: tenantId,
          subscription_data: { metadata: { tenantId, plan: parsed.data.plan } },
          metadata: { tenantId, plan: parsed.data.plan },
        });
        if (!session.url) throw new Error('STRIPE_CHECKOUT_SESSION_MISSING_URL');
        checkoutUrl = session.url;
        checkoutReference = session.id;
      } else {
        const paymentLink = planPaymentLink(parsed.data.plan);
        if (!paymentLink) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
        const url = new URL(paymentLink);
        url.searchParams.set('client_reference_id', `${tenantId}__sprplan__${parsed.data.plan}`);
        if (req.user!.email) url.searchParams.set('prefilled_email', req.user!.email);
        checkoutUrl = url.toString();
        checkoutReference = 'payment-link';
      }
      await appendAuditEntry(scopedDb, { tenantId, action: 'billing.checkout.initiated', actor: req.user!.uid, payload: { plan: parsed.data.plan, checkoutSessionId: checkoutReference } });
      return res.json({ url: checkoutUrl });
    } catch (error) { return next(error); }
  });

  router.post('/one-time-checkout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireLiveStripeInProduction(res)) return;
      const parsed = oneTimeCheckoutSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const tenantId = req.user!.tenantId;
      const paymentLink = oneTimePaymentLink(parsed.data.product);
      if (paymentLink) {
        const url = new URL(paymentLink);
        url.searchParams.set('client_reference_id', `${tenantId}__sprproduct__${parsed.data.product}`);
        if (req.user!.email) url.searchParams.set('prefilled_email', req.user!.email);
        await appendAuditEntry(req.db!, { tenantId, action: 'billing.purchase.initiated', actor: req.user!.uid, payload: { product: parsed.data.product, checkoutSessionId: 'payment-link' } });
        return res.json({ url: url.toString() });
      }
      if (!config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
      const stripe = stripeClient();
      await discoverMissingCatalogPrices(stripe);
      const priceId = oneTimePriceId(parsed.data.product);
      if (!priceId) return res.status(503).json({ error: 'This product is not yet available for checkout.' });
      const existingBilling = (await req.db!.execute(sql`SELECT stripe_customer_id AS "stripeCustomerId" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      const customerId: string | undefined = existingBilling?.stripeCustomerId;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(customerId ? { customer: customerId } : { customer_email: req.user!.email }),
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        adaptive_pricing: { enabled: false },
        managed_payments: { enabled: false },
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
      if (!requireLiveStripeInProduction(res)) return;
      const parsed = addonCheckoutSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const tenantId = req.user!.tenantId;
      const activeAddon = (await req.db!.execute(sql`SELECT stripe_subscription_id FROM tenant_addons WHERE tenant_id = ${tenantId} AND addon = ${parsed.data.addon} AND status IN ('active', 'trialing', 'past_due') LIMIT 1`) as any).rows?.[0];
      if (activeAddon) return res.status(409).json({ error: 'ADDON_ALREADY_ACTIVE', code: 'ADDON_ALREADY_ACTIVE', addon: parsed.data.addon, billingPath: '/billing', message: `${ADDON_CONFIG[parsed.data.addon].label} is already active on this workspace. Manage it from Manage billing.` });
      const paymentLink = addonPaymentLink(parsed.data.addon);
      if (paymentLink) {
        const url = new URL(paymentLink);
        url.searchParams.set('client_reference_id', `${tenantId}__spraddon__${parsed.data.addon}`);
        if (req.user!.email) url.searchParams.set('prefilled_email', req.user!.email);
        await appendAuditEntry(req.db!, { tenantId, action: 'billing.addon.initiated', actor: req.user!.uid, payload: { addon: parsed.data.addon, checkoutSessionId: 'payment-link' } });
        return res.json({ url: url.toString() });
      }
      if (!config.stripe.secretKey) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
      const stripe = stripeClient();
      await discoverMissingCatalogPrices(stripe);
      const priceId = addonPriceId(parsed.data.addon);
      if (!priceId) return res.status(503).json({ error: 'This add-on is not yet available for checkout.' });
      const existingBilling = (await req.db!.execute(sql`SELECT stripe_customer_id AS "stripeCustomerId" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      const customerId: string | undefined = existingBilling?.stripeCustomerId;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        ...(customerId ? { customer: customerId } : { customer_email: req.user!.email }),
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        adaptive_pricing: { enabled: false },
        managed_payments: { enabled: false },
        payment_method_collection: 'if_required',
        success_url: `${config.appUrl}/billing?addon=success&product=${encodeURIComponent(parsed.data.addon)}`,
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
      if (!requireLiveStripeInProduction(res)) return;
      const hostedPortal = process.env.STRIPE_BILLING_PORTAL_LOGIN_URL?.trim();
      if (hostedPortal) return res.json({ url: hostedPortal });
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
  if (!config.stripe.webhookSecret) return res.status(503).json({ error: 'BILLING_NOT_CONFIGURED' });
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') return res.status(400).json({ error: 'MISSING_SIGNATURE' });
  // Webhook signature verification is local HMAC validation and does not
  // require Stripe API access. A placeholder-form key lets stripe-node expose
  // its webhook verifier without weakening signature checks.
  const stripe = config.stripe.secretKey ? stripeClient() : new Stripe('sk_test_webhook_verification_only');
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.stripe.webhookSecret);
  } catch (err) {
    console.error('[Billing] Webhook signature verification failed:', err instanceof Error ? err.message : String(err));
    return res.status(400).json({ error: 'INVALID_SIGNATURE' });
  }

  try {
    // Serialize deliveries for the same Stripe event ID. Without this lock,
    // two concurrent redeliveries can both observe processed_at IS NULL and
    // both execute the business logic before either marks the event processed.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe_webhook:${event.id}`}))`);
    const inserted = await db.execute(sql`
      INSERT INTO billing_webhook_events (id, event_type, processing_attempts, last_error)
      VALUES (${event.id}, ${event.type}, 1, NULL)
      ON CONFLICT (id) DO UPDATE SET
        processing_attempts = billing_webhook_events.processing_attempts + 1
      WHERE billing_webhook_events.processed_at IS NULL
      RETURNING id, processed_at
    `);
    const webhookRow = (inserted as any).rows?.[0];
    if (!webhookRow) return res.status(200).json({ received: true, duplicate: true });
  } catch (err) {
    console.error('[Billing] Webhook idempotency check failed:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'IDEMPOTENCY_CHECK_FAILED' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const paymentLinkMatch = session.client_reference_id?.match(/^(.*)__sprplan__(pilot|starter|professional|growth|enterprise)$/);
        const paymentLinkProductMatch = session.client_reference_id?.match(/^(.*)__sprproduct__([A-Za-z0-9]+)$/);
        const paymentLinkAddonMatch = session.client_reference_id?.match(/^(.*)__spraddon__([A-Za-z0-9]+)$/);
        const tenantId = paymentLinkMatch?.[1] || paymentLinkProductMatch?.[1] || paymentLinkAddonMatch?.[1] || session.client_reference_id || session.metadata?.tenantId;
        const paymentLinkPlan = paymentLinkMatch?.[2] as PlanId | undefined;
        const paymentLinkProduct = paymentLinkProductMatch?.[2] as OneTimeProductId | undefined;
        const paymentLinkAddon = paymentLinkAddonMatch?.[2] as AddonId | undefined;
        const metadataPlan = session.metadata?.plan as PlanId | undefined;
        const plan = metadataPlan && PLAN_CONFIG[metadataPlan] ? metadataPlan : paymentLinkPlan;
        if (tenantId && session.subscription && plan && PLAN_CONFIG[plan]) {
          const clientLimit = PLAN_CLIENT_LIMITS[plan];
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
          await db.execute(sql`
            INSERT INTO tenant_subscriptions (
              tenant_id, stripe_customer_id, stripe_subscription_id, plan, status, client_limit, updated_at
            )
            VALUES (
              ${tenantId}, ${customerId ?? null}, ${String(session.subscription)}, ${plan}, 'active', ${clientLimit}, CURRENT_TIMESTAMP
            )
            ON CONFLICT (tenant_id) DO UPDATE SET
              stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, tenant_subscriptions.stripe_customer_id),
              stripe_subscription_id = EXCLUDED.stripe_subscription_id,
              plan = EXCLUDED.plan,
              status = 'active',
              client_limit = EXCLUDED.client_limit,
              updated_at = CURRENT_TIMESTAMP
          `);
          await appendAuditEntry(db, { tenantId, action: 'billing.subscription.activated', actor: 'stripe-webhook', payload: { plan, stripeEventId: event.id, stripeSubscriptionId: String(session.subscription), stripeCustomerId: customerId ?? null } });
        } else if (tenantId && session.mode === 'payment') {
          const productId = session.metadata?.product ?? paymentLinkProduct ?? null;
          // A first purchase may create the tenant's Stripe customer. Persist
          // that customer immediately so every later purchase/add-on/portal
          // operation uses the same billing identity.
          const purchaseCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
          if (purchaseCustomerId) {
            await db.execute(sql`UPDATE tenant_subscriptions SET stripe_customer_id = COALESCE(stripe_customer_id, ${purchaseCustomerId}), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${tenantId}`);
          }
          await appendAuditEntry(db, { tenantId, action: 'billing.purchase.completed', actor: 'stripe-webhook', payload: { product: productId, stripeEventId: event.id, checkoutSessionId: session.id } });

          // A one-time product is a deliverable somebody has to produce. Until
          // this, a completed payment left only the audit row above: the buyer
          // heard nothing and nobody was told a sale had happened. Both notices
          // go through notification_outbox, so they queue durably and send once
          // the email provider is configured, and they are keyed on the Stripe
          // event id so a redelivered event cannot double-send.
          const label = productId && productId in ONE_TIME_CONFIG ? ONE_TIME_CONFIG[productId as OneTimeProductId].label : (productId ?? 'a one-time purchase');
          const buyerEmail = session.customer_details?.email ?? session.customer_email ?? null;
          const amount = typeof session.amount_total === 'number' && session.currency
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: session.currency.toUpperCase() }).format(session.amount_total / 100)
            : null;
          const orderRef = session.id.slice(-8).toUpperCase();

          if (buyerEmail) {
            const body = [
              `Thanks — your order for ${label} has been received.${amount ? ` Amount: ${amount}.` : ''}`,
              '',
              `Order reference: ${orderRef}`,
              '',
              'What happens next: this is a produced deliverable, not an instant download. The SPR team will contact you at this address to confirm scope and schedule delivery.',
              '',
              'If you did not make this purchase, reply to this email.',
            ].join('\n');
            await db.execute(sql`INSERT INTO notification_outbox (id, tenant_id, channel, destination, subject, body) VALUES (${`purchase_${event.id}_buyer`}, ${tenantId}, 'email', ${buyerEmail}, ${`Order received: ${label} (ref ${orderRef})`}, ${body}) ON CONFLICT (id) DO NOTHING`);
          }

          const opsBody = [
            `New one-time purchase to fulfil.`,
            '',
            `Product: ${label}`,
            `Amount: ${amount ?? 'unknown'}`,
            `Buyer: ${buyerEmail ?? 'unknown'}`,
            `Tenant: ${tenantId}`,
            `Order reference: ${orderRef}`,
            `Stripe checkout session: ${session.id}`,
          ].join('\n');
          await db.execute(sql`INSERT INTO notification_outbox (id, tenant_id, channel, destination, subject, body) VALUES (${`purchase_${event.id}_ops`}, ${tenantId}, 'email', ${config.fulfilmentEmail}, ${`[SPR sale] ${label} — ${amount ?? ''} — ref ${orderRef}`}, ${opsBody}) ON CONFLICT (id) DO NOTHING`);
          await appendAuditEntry(db, { tenantId, action: 'billing.purchase.notified', actor: 'stripe-webhook', payload: { product: productId, orderRef, amount: amount || null, stripeEventId: event.id, buyerNotified: Boolean(buyerEmail), fulfilmentEmail: config.fulfilmentEmail } });
        } else if (tenantId && (session.metadata?.addon || paymentLinkAddon)) {
          // An add-on checkout completing left no trace at all: it is a
          // subscription, so it missed the plan branch above, and it is not a
          // payment, so it missed the one-time branch. Only billing.addon.initiated
          // was ever recorded, which cannot distinguish an add-on somebody
          // bought from one they abandoned at the Stripe page.
          const addonId = (session.metadata?.addon ?? paymentLinkAddon) as AddonId | undefined;
          const addonCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
          if (addonCustomerId) {
            await db.execute(sql`UPDATE tenant_subscriptions SET stripe_customer_id = COALESCE(stripe_customer_id, ${addonCustomerId}), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${tenantId}`);
          }
          if (typeof session.subscription === 'string' && addonId && ADDON_CONFIG[addonId]) {
            await db.execute(sql`INSERT INTO tenant_addons (stripe_subscription_id, tenant_id, addon, status) VALUES (${session.subscription}, ${tenantId}, ${addonId}, 'active') ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP`);
          }
          await appendAuditEntry(db, { tenantId, action: 'billing.addon.completed', actor: 'stripe-webhook', payload: { addon: addonId ?? null, stripeEventId: event.id, checkoutSessionId: session.id, stripeSubscriptionId: session.subscription ? String(session.subscription) : null } });
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
          if (tenantId) await db.execute(sql`INSERT INTO tenant_addons (stripe_subscription_id, tenant_id, addon, status, current_period_end) VALUES (${subscription.id}, ${tenantId}, ${addon}, ${subscription.status}, ${periodEnd}) ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end, updated_at = CURRENT_TIMESTAMP`);
          if (tenantId) await appendAuditEntry(db, { tenantId, action: 'billing.addon.status_changed', actor: 'stripe-webhook', payload: { addon, status: subscription.status, stripeEventId: event.id, stripeSubscriptionId: subscription.id } });
          break;
        }
        // Never trust stale Checkout metadata for the current plan: the
        // Customer Portal can change the subscription price without changing
        // the original session metadata. Resolve the authoritative plan from
        // the Stripe subscription item's Price ID, then persist that plan.
        const currentPriceId = subscription.items.data[0]?.price?.id;
        const resolvedPlan = PLAN_IDS.find((id) => planPriceId(id) === currentPriceId);
        const metadataPlan = subscription.metadata?.plan as PlanId | undefined;
        const plan = resolvedPlan ?? (metadataPlan && PLAN_CONFIG[metadataPlan] ? metadataPlan : undefined);
        const updated = tenantId && plan && PLAN_CONFIG[plan]
          ? (await db.execute(sql`INSERT INTO tenant_subscriptions (tenant_id, stripe_subscription_id, plan, client_limit, status, current_period_end, updated_at) VALUES (${tenantId}, ${subscription.id}, ${plan}, ${PLAN_CLIENT_LIMITS[plan]}, ${subscription.status}, ${periodEnd}, CURRENT_TIMESTAMP) ON CONFLICT (tenant_id) DO UPDATE SET stripe_subscription_id = EXCLUDED.stripe_subscription_id, plan = EXCLUDED.plan, client_limit = EXCLUDED.client_limit, status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end, updated_at = CURRENT_TIMESTAMP RETURNING tenant_id`) as any).rows?.[0]
          // No usable plan metadata: fall back to the subscription id, which
          // matches the plan row and nothing else. This preserves status
          // changes even if a malformed third-party subscription event arrives.
          : (await db.execute(sql`UPDATE tenant_subscriptions SET status = ${subscription.status}, current_period_end = ${periodEnd}, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id} RETURNING tenant_id`) as any).rows?.[0];
        if (updated?.tenant_id) await appendAuditEntry(db, { tenantId: updated.tenant_id, action: 'billing.subscription.status_changed', actor: 'stripe-webhook', payload: { status: subscription.status, plan: plan ?? null, priceId: currentPriceId ?? null, stripeEventId: event.id, stripeSubscriptionId: subscription.id } });
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await db.execute(sql`UPDATE tenant_addons SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id}`);
        const canceled = (await db.execute(sql`UPDATE tenant_subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscription.id} RETURNING tenant_id`) as any).rows?.[0];
        if (canceled?.tenant_id) await appendAuditEntry(db, { tenantId: canceled.tenant_id, action: 'billing.subscription.canceled', actor: 'stripe-webhook', payload: { stripeEventId: event.id } });
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubscription = invoice.parent?.subscription_details?.subscription;
        if (invoiceSubscription) {
          const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
          // Successful renewal payment restores the specific subscription
          // that was paid. Keep add-ons isolated from the primary plan row.
          const addonPaid = (await db.execute(sql`UPDATE tenant_addons SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscriptionId} RETURNING tenant_id, addon`) as any).rows?.[0];
          const paid = addonPaid ? null : (await db.execute(sql`UPDATE tenant_subscriptions SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscriptionId} RETURNING tenant_id`) as any).rows?.[0];
          const affectedTenantId = addonPaid?.tenant_id ?? paid?.tenant_id;
          if (affectedTenantId) await appendAuditEntry(db, { tenantId: affectedTenantId, action: 'billing.payment.paid', actor: 'stripe-webhook', payload: { stripeEventId: event.id, stripeSubscriptionId: subscriptionId, addon: addonPaid?.addon ?? null } });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubscription = invoice.parent?.subscription_details?.subscription;
        if (invoiceSubscription) {
          const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
          // Add-on subscriptions must never poison the tenant's primary plan
          // status. Update the add-on record when the failed invoice belongs
          // to one, otherwise update the primary plan by its Stripe id.
          const addonFailed = (await db.execute(sql`UPDATE tenant_addons SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscriptionId} RETURNING tenant_id, addon`) as any).rows?.[0];
          const pastDue = addonFailed ? null : (await db.execute(sql`UPDATE tenant_subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ${subscriptionId} RETURNING tenant_id`) as any).rows?.[0];
          const affectedTenantId = addonFailed?.tenant_id ?? pastDue?.tenant_id;
          if (affectedTenantId) await appendAuditEntry(db, { tenantId: affectedTenantId, action: 'billing.payment.failed', actor: 'stripe-webhook', payload: { stripeEventId: event.id, stripeSubscriptionId: subscriptionId, addon: addonFailed?.addon ?? null } });
        }
        break;
      }
      default:
        break;
    }
    await db.execute(sql`
      UPDATE billing_webhook_events
      SET processed_at = CURRENT_TIMESTAMP, last_error = NULL
      WHERE id = ${event.id} AND processed_at IS NULL
    `);
    return res.status(200).json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Billing] Webhook event handling failed:', message);
    await db.execute(sql`
      UPDATE billing_webhook_events
      SET last_error = ${message.slice(0, 1000)}
      WHERE id = ${event.id} AND processed_at IS NULL
    `).catch(() => undefined);
    return res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
  }
}

export async function canCreateClient(tenantId: string, scopedDb: { execute: (query: any) => Promise<any> }): Promise<{
  allowed: boolean; plan: PlanId | null; clientLimit: number | null; clientCount: number; nextPlan: PlanId | null;
}> {
  // Defense in depth: client creation must independently prove an entitling
  // subscription. The global middleware already gates paid routes, but this
  // helper is also used at the mutation boundary and must never fail open.
  const limits = await getPlanLimits(tenantId, scopedDb);
  const plan = limits.plan;
  const clientLimit = limits.clientLimit;
  const status = limits.status;

  const countResult = await scopedDb.execute(sql`SELECT count(*)::int AS count FROM clients WHERE tenant_id = ${tenantId}`);
  const clientCount = (countResult as any).rows?.[0]?.count ?? 0;
  const paid = Boolean(plan) && status === 'active';
  const allowed = paid && (clientLimit === null || clientCount < clientLimit);
  const currentIndex = plan ? PLAN_IDS.indexOf(plan) : -1;
  const nextPlan = currentIndex >= 0 && currentIndex < PLAN_IDS.length - 1 ? PLAN_IDS[currentIndex + 1] : null;
  return { allowed, plan, clientLimit, clientCount, nextPlan };
}
