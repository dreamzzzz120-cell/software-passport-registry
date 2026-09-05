/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Recognising the plan ceiling in an API response.
//
// Two routes enforce the Active Passport entitlement -- /api/monitoring and
// /api/integration-monitoring -- and the database enforces it a third time in
// migration 0064, which is what catches a concurrent request that slipped past
// both. All three now answer with the same 409 shape, so the client needs one
// recogniser rather than a special case per route.
//
// Deliberately a pure function over an already-parsed body: the fetch layer
// stays responsible for reading the response, and this stays testable without a
// network or a DOM.

export interface CapacityLimit {
  activePassports: number;
  includedActivePassports: number;
  /** Present when the tenant has no active subscription at all. */
  subscriptionStatus?: string;
}

/**
 * The capacity limit this response reports, or null if it reports something
 * else. Requires the 409 status as well as the body: a body that merely looks
 * like this on a 200 is not a limit, and treating it as one would show an
 * upgrade prompt over a successful action.
 */
export function capacityLimitFrom(status: number, body: unknown): CapacityLimit | null {
  if (status !== 409 || !body || typeof body !== 'object') return null;
  const payload = body as Record<string, unknown>;
  if (payload.error !== 'ACTIVE_PASSPORT_LIMIT_REACHED') return null;
  if (payload.billingUnit !== 'active_passport') return null;

  const active = Number(payload.activePassports);
  const included = Number(payload.includedActivePassports);
  return {
    activePassports: Number.isFinite(active) && active >= 0 ? active : 0,
    includedActivePassports: Number.isFinite(included) && included >= 0 ? included : 0,
    subscriptionStatus: typeof payload.subscriptionStatus === 'string' ? payload.subscriptionStatus : undefined,
  };
}

/**
 * What to tell the customer. Distinguishes the two situations that produce the
 * same status code, because they need different actions: a tenant with no
 * subscription needs to start one, a tenant on a plan needs a bigger one.
 */
export function capacityMessage(limit: CapacityLimit): { headline: string; detail: string; cta: string } {
  const unsubscribed = limit.includedActivePassports === 0
    || (limit.subscriptionStatus !== undefined && ['none', 'canceled', 'cancelled'].includes(limit.subscriptionStatus));

  if (unsubscribed) {
    return {
      headline: 'Continuous monitoring needs an active plan',
      detail: `Monitoring keeps a Passport under continuous verification. Your workspace has ${limit.activePassports} active Passport${limit.activePassports === 1 ? '' : 's'} and no plan covering them.`,
      cta: 'Choose a plan',
    };
  }
  return {
    headline: 'You have reached your plan’s Active Passport limit',
    detail: `Your plan covers ${limit.includedActivePassports} active Passport${limit.includedActivePassports === 1 ? '' : 's'} and ${limit.activePassports} are in use. Upgrading raises the limit and keeps the Passports you already monitor untouched.`,
    cta: 'Upgrade plan',
  };
}
