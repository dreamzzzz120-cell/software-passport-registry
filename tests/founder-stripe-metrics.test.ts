import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ customers: vi.fn(), subscriptions: vi.fn(), payments: vi.fn(), constructor: vi.fn(), config: { stripe: { secretKey: 'sk_live_unit' as string | undefined }, isProduction: true } }));
vi.mock('../src/config.ts', () => ({ config: mocks.config }));
vi.mock('stripe', () => ({ default: class {
  customers = { list: mocks.customers }; subscriptions = { list: mocks.subscriptions }; paymentIntents = { list: mocks.payments };
  constructor(...args: unknown[]) { mocks.constructor(...args); }
} }));
import { checkStripeAndMrr, subscriptionMonthlyUsd } from '../src/lib/server/founder/connections';
const stream = (rows: unknown[]) => ({ async *[Symbol.asyncIterator]() { yield* rows; } });
const subscription = (price: Record<string, unknown> = {}, discounts: unknown[] = []) => ({ items: { data: [{ quantity: 1, price: { unit_amount: 12000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, ...price } }] }, discounts });
beforeEach(() => {
  vi.clearAllMocks(); mocks.config.stripe.secretKey = 'sk_live_unit'; mocks.config.isProduction = true;
  mocks.customers.mockReturnValue(stream([{ id: 'one' }, { id: 'two' }]));
  mocks.subscriptions.mockReturnValue(stream([subscription()]));
  mocks.payments.mockReturnValue(stream([{ status: 'succeeded', currency: 'usd', amount_received: 5000 }, { status: 'processing', currency: 'usd', amount_received: 0 }]));
});
afterEach(() => { vi.useRealTimers(); });

describe('independent founder Stripe telemetry', () => {
  it('returns exact completed reads with the current coupon expansion and bounded SDK requests', async () => {
    const result = await checkStripeAndMrr();
    expect(result).toMatchObject({ customerCount: 2, activeSubscriptionCount: 1, mrrCents: 12000, successfulPaymentCount30d: 1, successfulPaymentAmount30dCents: 5000 });
    expect(result.connection.status).toBe('ok');
    expect(mocks.constructor).toHaveBeenCalledWith('sk_live_unit', { timeout: 8000, maxNetworkRetries: 0 });
    expect(mocks.subscriptions).toHaveBeenCalledWith({ status: 'active', limit: 100, expand: ['data.discounts.source.coupon'] });
  });
  it('keeps customers and subscriptions when payments cannot be read, without exposing upstream secrets', async () => {
    mocks.payments.mockImplementation(() => { throw Object.assign(new Error('sk_live_sensitive and provider response'), { statusCode: 403 }); });
    const result = await checkStripeAndMrr();
    expect(result).toMatchObject({ customerCount: 2, activeSubscriptionCount: 1, mrrCents: 12000, successfulPaymentCount30d: null, successfulPaymentAmount30dCents: null });
    expect(result.connection.detail).toContain('payments unavailable (read permission missing)');
    expect(JSON.stringify(result)).not.toContain('sk_live_sensitive');
  });
  it('does not publish a partial count when pagination fails after yielding a page', async () => {
    mocks.customers.mockReturnValue({ async *[Symbol.asyncIterator]() { yield { id: 'first' }; throw new Error('page two failed'); } });
    const result = await checkStripeAndMrr();
    expect(result.customerCount).toBeNull(); expect(result.activeSubscriptionCount).toBe(1);
  });
  it('bounds a stalled provider stream while retaining other completed reads', async () => {
    vi.useFakeTimers();
    mocks.payments.mockReturnValue({ [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } });
    const pending = checkStripeAndMrr();
    await vi.advanceTimersByTimeAsync(8001);
    const result = await pending;
    expect(result.customerCount).toBe(2); expect(result.successfulPaymentCount30d).toBeNull();
    expect(result.connection.detail).toContain('payments unavailable (check timed out)');
  });
  it('keeps completed counts when non-USD amounts cannot be combined into USD totals', async () => {
    mocks.subscriptions.mockReturnValue(stream([subscription({ currency: 'cad' })]));
    mocks.payments.mockReturnValue(stream([{ status: 'succeeded', currency: 'cad', amount_received: 5000 }]));
    const result = await checkStripeAndMrr();
    expect(result).toMatchObject({ activeSubscriptionCount: 1, mrrCents: null, successfulPaymentCount30d: 1, successfulPaymentAmount30dCents: null });
  });
  it('fails closed on test keys in production without querying test account data', async () => {
    mocks.config.stripe.secretKey = 'rk_test_unit';
    const result = await checkStripeAndMrr();
    expect(result.customerCount).toBeNull(); expect(result.connection.status).toBe('error');
    expect(result.connection.detail).toContain('TEST MODE'); expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it('labels a development test account as TEST MODE', async () => {
    mocks.config.stripe.secretKey = 'sk_test_unit'; mocks.config.isProduction = false;
    expect((await checkStripeAndMrr()).connection.detail).toContain('TEST MODE');
  });
  it('reports real empty reads as zero and missing configuration as unknown', async () => {
    mocks.customers.mockReturnValue(stream([])); mocks.subscriptions.mockReturnValue(stream([])); mocks.payments.mockReturnValue(stream([]));
    expect(await checkStripeAndMrr()).toMatchObject({ customerCount: 0, activeSubscriptionCount: 0, mrrCents: 0, successfulPaymentCount30d: 0 });
    mocks.config.stripe.secretKey = undefined;
    expect(await checkStripeAndMrr()).toMatchObject({ customerCount: null, mrrCents: null, connection: { status: 'not_configured' } });
  });
});

describe('USD monthly subscription amounts', () => {
  it('applies expanded percentage coupons and normalizes fixed annual coupons per billing period', () => {
    expect(subscriptionMonthlyUsd(subscription({}, [{ source: { coupon: { percent_off: 25 } } }]))).toBe(9000);
    expect(subscriptionMonthlyUsd(subscription({ recurring: { interval: 'year', interval_count: 1 } }, [{ source: { coupon: { amount_off: 1200, currency: 'usd' } } }]))).toBe(900);
  });
  it('preserves fractional monthly cents until the account total is rounded', async () => {
    mocks.subscriptions.mockReturnValue(stream([subscription({ unit_amount: 100, recurring: { interval: 'year' } }), subscription({ unit_amount: 100, recurring: { interval: 'year' } })]));
    expect((await checkStripeAndMrr()).mrrCents).toBe(17);
  });
  it('keeps incomplete, metered and unexpanded discount data unknown', () => {
    expect(subscriptionMonthlyUsd(subscription({ unit_amount: null }))).toBeNull();
    expect(subscriptionMonthlyUsd(subscription({ recurring: { interval: 'month', usage_type: 'metered' } }))).toBeNull();
    expect(subscriptionMonthlyUsd(subscription({}, ['discount-id']))).toBeNull();
    expect(subscriptionMonthlyUsd({ ...subscription(), items: { ...subscription().items, has_more: true } })).toBeNull();
  });
});
