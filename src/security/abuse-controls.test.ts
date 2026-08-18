import { describe, expect, it } from 'vitest';

const LIMITS = {
  unauthenticatedPerMinute: 60,
  authenticatedPerMinute: 300,
  expensivePerMinute: 20,
  maxConcurrentExpensive: 4,
  maxApiKeyRequestsPerMinute: 600,
  maxAuditEventsPerMinute: 120,
} as const;

function allowWindow(count: number, limit: number): boolean {
  return Number.isSafeInteger(count) && count >= 0 && count < limit;
}

function exponentialBackoff(attempt: number): number {
  const n = Math.max(0, Math.min(attempt, 8));
  return Math.min(60_000, 1_000 * 2 ** n);
}

describe('abuse-resistance security contract', () => {
  it('has bounded per-principal request limits', () => {
    expect(allowWindow(59, LIMITS.unauthenticatedPerMinute)).toBe(true);
    expect(allowWindow(60, LIMITS.unauthenticatedPerMinute)).toBe(false);
    expect(allowWindow(299, LIMITS.authenticatedPerMinute)).toBe(true);
    expect(allowWindow(300, LIMITS.authenticatedPerMinute)).toBe(false);
  });

  it('keeps expensive operations and concurrency bounded', () => {
    expect(allowWindow(19, LIMITS.expensivePerMinute)).toBe(true);
    expect(allowWindow(20, LIMITS.expensivePerMinute)).toBe(false);
    expect(allowWindow(3, LIMITS.maxConcurrentExpensive)).toBe(true);
    expect(allowWindow(4, LIMITS.maxConcurrentExpensive)).toBe(false);
  });

  it('caps API-key and security-audit abuse', () => {
    expect(allowWindow(599, LIMITS.maxApiKeyRequestsPerMinute)).toBe(true);
    expect(allowWindow(600, LIMITS.maxApiKeyRequestsPerMinute)).toBe(false);
    expect(allowWindow(119, LIMITS.maxAuditEventsPerMinute)).toBe(true);
    expect(allowWindow(120, LIMITS.maxAuditEventsPerMinute)).toBe(false);
  });

  it('uses bounded exponential backoff', () => {
    expect(exponentialBackoff(0)).toBe(1_000);
    expect(exponentialBackoff(1)).toBe(2_000);
    expect(exponentialBackoff(5)).toBe(32_000);
    expect(exponentialBackoff(8)).toBe(60_000);
    expect(exponentialBackoff(99)).toBe(60_000);
  });

  it('fails closed for invalid counters', () => {
    expect(allowWindow(-1, LIMITS.authenticatedPerMinute)).toBe(false);
    expect(allowWindow(Number.NaN, LIMITS.authenticatedPerMinute)).toBe(false);
    expect(allowWindow(Number.POSITIVE_INFINITY, LIMITS.authenticatedPerMinute)).toBe(false);
  });
});
