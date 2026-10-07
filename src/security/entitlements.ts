import { sql } from 'drizzle-orm';
import type { Response, Request } from 'express';
import type { ScopedDb } from '../middleware/tenant-scope.ts';

export type Capability = 'workspace' | 'passport' | 'sbom' | 'monitoring' | 'vendor_risk' | 'governance' | 'msp' | 'white_label' | 'bulk_export' | 'api' | 'enterprise_controls' | 'trust_badge' | 'public_passport';

const PATH_CAPABILITIES: Array<{ capability: Capability; test: (path: string) => boolean }> = [
  { capability: 'bulk_export', test: p => p.includes('/export') },
  { capability: 'vendor_risk', test: p => p.includes('/vendors') },
  { capability: 'governance', test: p => p.includes('/governance') || p.includes('/privacy') || p.includes('/compliance') },
  { capability: 'msp', test: p => p.includes('/msp') },
  { capability: 'monitoring', test: p => p.includes('/monitoring') || p.includes('/integration-monitoring') },
  // 'api' is the machine-to-machine SPR Connect / Agent API (an add-on). The
  // product's own integration screens (/api/integrations, /api/integrations-
  // live: connect a repo, save credentials) are core workspace function and
  // must not be gated behind it -- a paying MSP Starter customer was locked
  // out of connecting GitHub the moment their subscription activated.
  { capability: 'api', test: p => p.includes('/agent/v1') || p === '/api/connect' || p.startsWith('/api/connect/') || p.includes('/api/integrations/connect') },
  // No path maps to enterprise_controls: /api/organization/* (team, branding,
  // invites) and /api/tenant/* (offboarding, deletion requests) are basic
  // workspace administration and a customer's own data rights, not an
  // Enterprise-tier feature. The capability stays defined for explicit
  // enforceCapability() use if a real enterprise-only control is ever built.
  { capability: 'sbom', test: p => p.includes('/scan') || p.includes('/sbom') },
  { capability: 'passport', test: p => p.includes('/passport') || p.includes('/trust-loop') },
];

export function capabilityForPath(req: Request): Capability {
  const path = `${req.baseUrl}${req.path}`.toLowerCase();
  return PATH_CAPABILITIES.find(item => item.test(path))?.capability ?? 'workspace';
}

// Maximum launch-hardening policy: only a positively confirmed ACTIVE Stripe
// subscription unlocks paid workspace capabilities. Trialing, past_due,
// incomplete, canceled, unpaid, missing, or unknown states all fail closed.
// Billing/account recovery routes are exempted separately so customers can pay.
export const PLAN_ENTITLING_STATUSES = ['active'] as const;

// 'incomplete' is not an entitling Stripe state. A checkout that has not
// completed payment must not unlock the workspace.
export const PRE_PAYMENT_STATUSES = ['incomplete'] as const;

// capabilityForPath() falls back to workspace for normal authenticated app
// routes. Billing and identity recovery are exempted before capability
// evaluation; there is intentionally no free workspace capability at launch.
export const BASELINE_CAPABILITY: Capability = 'workspace';

const ENTITLING_STATUSES_SQL = sql.join(PLAN_ENTITLING_STATUSES.map(status => sql`${status}`), sql`, `);

export type SubscriptionGate = 'unpaid' | 'enforce-plan' | 'lapsed';

export interface SubscriptionState { plan: string | null; status: string; currentPeriodEnd: string | null; }

export interface CapabilityDecision { allowed: boolean; gate: SubscriptionGate; state: SubscriptionState; }

interface SubscriptionRow { plan?: string | null; status?: string | null; currentPeriodEnd?: string | null }

/**
 * Launch policy: access follows confirmed billing evidence. A tenant with no
 * plan, or only a pre-payment state, is unpaid. Identity and billing recovery
 * routes are exempted earlier in requireAuth so the customer can still sign in,
 * choose a plan, complete Checkout, and manage billing.
 */
export function resolveSubscriptionGate(subscription: { plan: string | null; status: string }): SubscriptionGate {
  // Launch policy: no confirmed paid plan means no paid workspace capability.
  // Billing and identity routes remain exempt at the authenticated boundary so
  // an MSP can sign in, choose a plan, complete Checkout, and recover billing.
  if (!subscription.plan) return 'unpaid';
  if ((PRE_PAYMENT_STATUSES as readonly string[]).includes(subscription.status)) return 'unpaid';
  if ((PLAN_ENTITLING_STATUSES as readonly string[]).includes(subscription.status)) return 'enforce-plan';
  return 'lapsed';
}

export function lapsedPlanAllows(_capability: Capability): boolean {
  // A canceled or unpaid subscription keeps identity + billing access through
  // BILLING_EXEMPT_PATHS, but no paid workspace capability remains available.
  return false;
}

export async function readSubscriptionState(db: ScopedDb, tenantId: string): Promise<SubscriptionState> {
  const result = await db.execute(sql`SELECT plan, status, current_period_end AS "currentPeriodEnd" FROM tenant_subscriptions WHERE tenant_id = ${tenantId} LIMIT 1`);
  const row = (result as unknown as { rows?: SubscriptionRow[] }).rows?.[0];
  return { plan: row?.plan ?? null, status: row?.status ?? 'none', currentPeriodEnd: row?.currentPeriodEnd ?? null };
}

export async function tenantHasCapability(db: ScopedDb, tenantId: string, capability: Capability): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM plan_capabilities pc
      JOIN tenant_subscriptions ts ON ts.plan = pc.plan
      WHERE ts.tenant_id = ${tenantId}
        AND pc.capability = ${capability}
        AND pc.enabled = true
        AND ts.status IN (${ENTITLING_STATUSES_SQL})
    ) AS allowed
  `);
  return Boolean((result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]?.allowed);
}

/**
 * Single decision point for every capability check, so the authenticated API
 * boundary and the per-route enforceCapability() can never drift apart.
 */
// Add-ons that grant a capability on top of the plan. Founder decision
// 2026-09-11: Trust Badge and Public Software Passport are paid add-ons, not
// free -- minting a public passport link needs public_passport, rendering the
// embeddable badge additionally needs trust_badge. No plan tier grants either.
export const ADDON_CAPABILITY_GRANTS: Readonly<Record<string, Capability>> = { api: 'api', continuousVerification: 'monitoring', trustBadge: 'trust_badge', publicPassport: 'public_passport' };

export async function tenantHasAddonCapability(db: ScopedDb, tenantId: string, capability: Capability): Promise<boolean> {
  const addons = Object.entries(ADDON_CAPABILITY_GRANTS).filter(([, granted]) => granted === capability).map(([addon]) => addon);
  if (addons.length === 0) return false;
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM tenant_addons
      WHERE tenant_id = ${tenantId}
        AND addon IN (${sql.join(addons.map((addon) => sql`${addon}`), sql`, `)})
        AND status IN (${ENTITLING_STATUSES_SQL})
    ) AS allowed
  `);
  return Boolean((result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]?.allowed);
}

export async function evaluateCapability(db: ScopedDb, tenantId: string, capability: Capability): Promise<CapabilityDecision> {
  const state = await readSubscriptionState(db, tenantId);
  const gate = resolveSubscriptionGate(state);
  if (gate === 'unpaid') return { allowed: false, gate, state };
  if (gate === 'lapsed') return { allowed: lapsedPlanAllows(capability), gate, state };
  // A paid add-on grants its capability regardless of the plan tier.
  if (await tenantHasCapability(db, tenantId, capability)) return { allowed: true, gate, state };
  return { allowed: await tenantHasAddonCapability(db, tenantId, capability), gate, state };
}

export function capabilityDenial(capability: Capability, decision: CapabilityDecision) {
  if (decision.gate === 'unpaid') {
    return {
      error: 'SUBSCRIPTION_REQUIRED', code: 'SUBSCRIPTION_REQUIRED', capability,
      message: 'Choose an SPR plan to unlock the MSP workspace.',
      billingPath: '/billing', plan: null, subscriptionStatus: decision.state.status,
    };
  }
  if (decision.gate === 'lapsed') {
    return {
      error: 'SUBSCRIPTION_REQUIRED', code: 'SUBSCRIPTION_REQUIRED', capability,
      message: `The SPR subscription for this workspace is ${decision.state.status}. Reactivate it to use ${capability.replaceAll('_', ' ')}.`,
      billingPath: '/billing', plan: decision.state.plan, subscriptionStatus: decision.state.status,
    };
  }
  return {
    error: 'CAPABILITY_NOT_INCLUDED', code: 'CAPABILITY_NOT_INCLUDED', capability,
    message: `The active SPR plan does not include ${capability.replaceAll('_', ' ')}.`,
    billingPath: '/billing', plan: decision.state.plan,
  };
}

export async function enforceCapability(req: { user?: { tenantId: string }; db?: ScopedDb }, res: Response, capability: Capability): Promise<boolean> {
  if (!req.user?.tenantId || !req.db) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return false;
  }
  const decision = await evaluateCapability(req.db, req.user.tenantId, capability);
  if (decision.allowed) return true;
  res.status(402).json(capabilityDenial(capability, decision));
  return false;
}

export const PLAN_CAPABILITY_MATRIX: Record<string, Capability[]> = {
  pilot: ['workspace','passport','sbom','vendor_risk','governance','msp','white_label','bulk_export'],
  starter: ['workspace','passport','sbom'],
  professional: ['workspace','passport','sbom','monitoring','vendor_risk','governance','bulk_export'],
  growth: ['workspace','passport','sbom','monitoring','vendor_risk','governance','msp','white_label','bulk_export','api'],
  enterprise: ['workspace','passport','sbom','monitoring','vendor_risk','governance','msp','white_label','bulk_export','api','enterprise_controls'],
};
