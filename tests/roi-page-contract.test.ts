import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import express from 'express';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

vi.mock('../src/routes/billing.ts', () => ({
  buildCatalog: vi.fn(async () => ({
    billingConfigured: true,
    plans: [
      { id: 'starter', label: 'MSP Starter', priceLabel: '$149/month', unitAmount: 14900, currency: 'usd', interval: 'month', description: null, checkoutAvailable: true, clientLimit: 5 },
      { id: 'enterprise', label: 'Enterprise', priceLabel: null, unitAmount: null, currency: null, interval: null, description: null, checkoutAvailable: false, clientLimit: null },
    ],
    products: [{ id: 'one_time_review', label: 'One-time review', priceLabel: '$4', unitAmount: 400, currency: 'usd', interval: null, description: null, checkoutAvailable: true }],
    addons: [{ id: 'api', label: 'API access', priceLabel: '$49/month', unitAmount: 4900, currency: 'usd', interval: 'month', description: null, checkoutAvailable: true }],
  })),
}));

describe('/roi page contract', () => {
  it('renders only checkout-available recurring prices from the catalog and no pre-filled revenue figure', async () => {
    const { createRoiRouter } = await import('../src/routes/roi.ts');
    const app = express();
    app.use('/roi', createRoiRouter());
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/roi`);
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(text).toContain('MSP Starter');
      expect(text).toContain('$149/month');
      expect(text).toContain('API access');
      // Not sold / not recurring: never placed on a per-month line.
      expect(text).not.toContain('Enterprise —');
      expect(text).not.toContain('One-time review');
      // Every visitor-side input starts empty; the page never suggests earnings.
      for (const id of ['clients', 'price', 'hours', 'rate']) expect(text).toMatch(new RegExp(`id="${id}"[^>]*value=""`));
      expect(text).not.toMatch(/\$108,300|\$65\b/);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });

  it('is public, rate-limited, rewritten from the SPA domain, and listed in the dynamic sitemap', () => {
    const source = read('src/routes/roi.ts');
    expect(source).toContain('rateLimit(');
    expect(source).not.toMatch(/scopedDb|withTenantContext|sql`/);
    expect(read('server.ts')).toContain("app.use('/roi', rateLimiter, createRoiRouter());");
    expect(read('vercel.json')).toContain('"source": "/roi"');
    expect(read('src/routes/software-registry.ts')).toContain('`${PUBLIC_ORIGIN}/roi`');
  });
});
