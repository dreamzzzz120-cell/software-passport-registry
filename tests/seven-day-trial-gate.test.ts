import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveSubscriptionGate, PLAN_CAPABILITY_MATRIX } from '../src/security/entitlements.ts';

afterEach(() => vi.useRealTimers());

describe('card-free trial authorization', () => {
  const ends = '2026-10-16T18:00:00.000Z';
  it('allows an unexpired locally issued seven-day trial only', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-09T18:00:00.000Z'));
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'trialing', currentPeriodEnd: ends, stripeSubscriptionId: null })).toBe('trial');
    expect(PLAN_CAPABILITY_MATRIX.starter).toContain('workspace');
    expect(PLAN_CAPABILITY_MATRIX.starter).not.toContain('monitoring');
  });
  it('expires precisely at seven days', () => {
    vi.useFakeTimers().setSystemTime(new Date(ends));
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'trialing', currentPeriodEnd: ends, stripeSubscriptionId: null })).toBe('lapsed');
  });
  it('does not grant local trial from a Stripe subscription or absent expiry', () => {
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'trialing', currentPeriodEnd: '2099-01-01T00:00:00Z', stripeSubscriptionId: 'sub_real' })).toBe('lapsed');
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'trialing', currentPeriodEnd: null, stripeSubscriptionId: null })).toBe('lapsed');
    expect(resolveSubscriptionGate({ plan: null, status: 'none' })).toBe('unpaid');
  });
  it('preserves active paid plans and rejects failed states', () => {
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'active' })).toBe('enforce-plan');
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'past_due' })).toBe('lapsed');
    expect(resolveSubscriptionGate({ plan: 'starter', status: 'incomplete' })).toBe('unpaid');
  });
});
