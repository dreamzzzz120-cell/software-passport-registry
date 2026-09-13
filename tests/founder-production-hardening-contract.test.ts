import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Founder production hardening contracts', () => {
  const security = readFileSync(resolve(process.cwd(), 'src/middleware/security.ts'), 'utf8');
  const connections = readFileSync(resolve(process.cwd(), 'src/lib/server/founder/connections.ts'), 'utf8');

  it('keeps Founder routes independent of customer subscription billing', () => {
    expect(security).toContain("'/api/founder'");
    expect(security).toContain('requireFounder');
  });

  it('bounds external Founder health checks with a timeout', () => {
    expect(connections).toContain('CHECK_TIMEOUT_MS = 8_000');
    expect(connections).toContain('AbortController');
    expect(connections).toContain('fetchWithTimeout');
  });

  it('does not expose raw upstream error messages from Founder health checks', () => {
    expect(connections).toContain("return 'health check failed'");
    expect(connections).not.toContain('err?.message ?? \'unknown error\'');
  });

  it('does not silently cap Stripe customer/subscription counts at the first page', () => {
    expect(connections).toContain('for await (const _customer of stripe.customers.list');
    expect(connections).toContain('for await (const sub of stripe.subscriptions.list');
  });
});
