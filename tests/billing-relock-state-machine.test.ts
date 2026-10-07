import { describe, expect, it } from 'vitest';
import {
  PLAN_ENTITLING_STATUSES,
  PRE_PAYMENT_STATUSES,
  lapsedPlanAllows,
  resolveSubscriptionGate,
  type Capability,
} from '../src/security/entitlements.ts';

describe('billing relock state machine', () => {
  it('has exactly one plan-entitling Stripe status at launch', () => {
    expect([...PLAN_ENTITLING_STATUSES]).toEqual(['active']);
  });

  it.each([
    ['active', 'enforce-plan'],
    ['trialing', 'lapsed'],
    ['past_due', 'lapsed'],
    ['unpaid', 'lapsed'],
    ['canceled', 'lapsed'],
    ['paused', 'lapsed'],
    ['incomplete_expired', 'lapsed'],
  ] as const)('maps a persisted %s plan to %s', (status, expectedGate) => {
    expect(resolveSubscriptionGate({ plan: 'starter', status })).toBe(expectedGate);
  });

  it.each(PRE_PAYMENT_STATUSES)('treats pre-payment state %s as unpaid', (status) => {
    expect(resolveSubscriptionGate({ plan: 'starter', status })).toBe('unpaid');
  });

  it('treats a missing plan as unpaid even if a status says active', () => {
    expect(resolveSubscriptionGate({ plan: null, status: 'active' })).toBe('unpaid');
  });

  it.each([
    'workspace',
    'passport',
    'sbom',
    'monitoring',
    'vendor_risk',
    'governance',
    'msp',
    'white_label',
    'bulk_export',
    'api',
    'enterprise_controls',
    'trust_badge',
    'public_passport',
  ] as Capability[])('allows no paid capability through the lapsed-plan fallback: %s', (capability) => {
    expect(lapsedPlanAllows(capability)).toBe(false);
  });
});
