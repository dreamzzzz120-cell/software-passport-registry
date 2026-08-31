import { sql } from 'drizzle-orm';
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './security.ts';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Server-side commercial boundary for tenant-scoped product capabilities.
 *
 * Billing itself and the public free-review funnel intentionally sit outside
 * this middleware. Every protected product module must pass through the
 * authenticated tenant context first; no request parameter can select the
 * tenant being checked.
 */
export async function requirePaidSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const scopedDb = req.db;
    if (!tenantId || !scopedDb) {
      return res.status(403).json({
        error: 'SUBSCRIPTION_REQUIRED',
        message: 'An authenticated workspace is required.',
      });
    }

    const result = await scopedDb.execute(sql`
      SELECT plan, status, current_period_end AS "currentPeriodEnd"
      FROM tenant_subscriptions
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `);
    const subscription = (result as any).rows?.[0] as
      | { plan?: string | null; status?: string | null; currentPeriodEnd?: string | null }
      | undefined;

    if (!subscription?.plan || !subscription.status || !ACTIVE_STATUSES.has(subscription.status)) {
      return res.status(402).json({
        error: 'SUBSCRIPTION_REQUIRED',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'This SPR capability requires an active paid plan.',
        billingPath: '/billing',
        subscriptionStatus: subscription?.status ?? 'none',
      });
    }

    res.locals.billing = {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    };
    return next();
  } catch (error) {
    console.error('[Paywall] Entitlement lookup failed:', error instanceof Error ? error.message : String(error));
    return res.status(503).json({
      error: 'BILLING_UNAVAILABLE',
      code: 'BILLING_UNAVAILABLE',
      message: 'Billing entitlement could not be verified. Please try again.',
    });
  }
}
