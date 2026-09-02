import { sql } from 'drizzle-orm';
import type { Response, Request } from 'express';
import type { ScopedDb } from '../middleware/tenant-scope.ts';

export type Capability = 'workspace' | 'passport' | 'sbom' | 'monitoring' | 'vendor_risk' | 'governance' | 'msp' | 'white_label' | 'bulk_export' | 'api' | 'enterprise_controls';

const PATH_CAPABILITIES: Array<{ capability: Capability; test: (path: string) => boolean }> = [
  { capability: 'bulk_export', test: p => p.includes('/export') },
  { capability: 'vendor_risk', test: p => p.includes('/vendors') },
  { capability: 'governance', test: p => p.includes('/governance') || p.includes('/privacy') || p.includes('/compliance') },
  { capability: 'msp', test: p => p.includes('/msp') },
  { capability: 'monitoring', test: p => p.includes('/monitoring') || p.includes('/integration-monitoring') },
  { capability: 'api', test: p => p.includes('/agent/v1') || p === '/api/connect' || p.includes('/api/integrations') },
  { capability: 'enterprise_controls', test: p => p.includes('/tenant') || p.includes('/organization') },
  { capability: 'sbom', test: p => p.includes('/scan') || p.includes('/sbom') },
  { capability: 'passport', test: p => p.includes('/passport') || p.includes('/trust-loop') },
];

export function capabilityForPath(req: Request): Capability {
  const path = `${req.baseUrl}${req.path}`.toLowerCase();
  return PATH_CAPABILITIES.find(item => item.test(path))?.capability ?? 'workspace';
}

// Statuses in which a recorded plan still entitles the tenant to that plan's
// capabilities. 'past_due' is included deliberately: Stripe has not cancelled
// the subscription, it is retrying the payment, so cutting a paying customer
// off mid-dunning would be a false lockout rather than enforcement. Real
// cancellation arrives as 'canceled'/'unpaid' and is handled as lapsed below.
export const PLAN_ENTITLING_STATUSES = ['active', 'trialing', 'past_due'] as const;

// POST /api/billing/checkout writes a row with status 'incomplete' *before*
// the customer ever reaches Stripe. Starting -- or abandoning -- a checkout
// must never take away access the tenant had a moment earlier, so this state
// is treated exactly like having no plan on record at all.
export const PRE_PAYMENT_STATUSES = ['incomplete'] as const;

// Every plan in PLAN_CAPABILITY_MATRIX includes 'workspace', and
// capabilityForPath() falls back to it for any route that is not one of the
// specific paid capabilities. It is therefore the floor a lapsed tenant keeps:
// they can still reach their own workspace and the billing surface to
// resubscribe, while every paid capability is withheld. Their data is never
// hidden from them, which is what docs/billing-paywall-inventory.md requires
// of cancellation -- the webhook sets the status "without deleting any data".
export const BASELINE_CAPABILITY: Capability = 'workspace';

const ENTITLING_STATUSES_SQL = sql.join(PLAN_ENTITLING_STATUSES.map(status => sql`${status}`), sql`, `);

export type SubscriptionGate = 'default-access' | 'enforce-plan' | 'lapsed';

export interface SubscriptionState { plan: string | null; status: string; currentPeriodEnd: string | null; }

export interface CapabilityDecision { allowed: boolean; gate: SubscriptionGate; state: SubscriptionState; }

interface SubscriptionRow { plan?: string | null; status?: string | null; currentPeriodEnd?: string | null }

/**
 * The documented default, from docs/billing-paywall-inventory.md: "A tenant
 * with no tenant_subscriptions row (or no plan set) is treated as
 * unrestricted, not as 'no plan.'" A missing row means the tenant predates
 * billing or has never been through checkout -- it is not evidence that they
 * failed to pay. Treating absence as denial is what produced the blanket 402s
 * on /api/user/clients, /api/scans, /api/user/passports and the rest.
 *
 * Enforcement therefore begins only once a plan is actually recorded, which is
 * the same rule canCreateClient() and migration 0043's trigger already apply
 * when they treat a NULL client_limit as unrestricted.
 */
export function resolveSubscriptionGate(subscription: { plan: string | null; status: string }): SubscriptionGate {
  if (!subscription.plan) return 'default-access';
  if ((PRE_PAYMENT_STATUSES as readonly string[]).includes(subscription.status)) return 'default-access';
  if ((PLAN_ENTITLING_STATUSES as readonly string[]).includes(subscription.status)) return 'enforce-plan';
  return 'lapsed';
}

export function lapsedPlanAllows(capability: Capability): boolean {
  return capability === BASELINE_CAPABILITY;
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
export async function evaluateCapability(db: ScopedDb, tenantId: string, capability: Capability): Promise<CapabilityDecision> {
  const state = await readSubscriptionState(db, tenantId);
  const gate = resolveSubscriptionGate(state);
  if (gate === 'default-access') return { allowed: true, gate, state };
  if (gate === 'lapsed') return { allowed: lapsedPlanAllows(capability), gate, state };
  return { allowed: await tenantHasCapability(db, tenantId, capability), gate, state };
}

export function capabilityDenial(capability: Capability, decision: CapabilityDecision) {
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
