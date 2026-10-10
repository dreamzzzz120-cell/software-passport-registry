import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/routes/commercial.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0146_client_service_quotes.sql', import.meta.url), 'utf8');

describe('client service quote contract', () => {
  it('requires identity and an MSP role before drafting and offering', () => {
    expect(source).toMatch(/router\.post\('\/quotes', requireAuth, requireRole\(\['Owner','Admin'\]\)/);
    expect(source).toMatch(/router\.post\('\/quotes\/:id\/offer', requireAuth, requireRole\(\['Owner','Admin'\]\)/);
  });
  it('binds decisions to the authenticated client and offered status', () => {
    expect(source).toMatch(/router\.post\('\/quotes\/:id\/decision', requireAuth, requireRole\(\['Client'\]\)/);
    expect(source).toContain('client_id=${req.user!.clientId}');
    expect(source).toContain("AND status='OFFERED'");
  });
  it('does not pretend approval is payment or launch Stripe', () => {
    expect(source).toContain("paymentStatus:'NOT_INTEGRATED'");
    expect(source).toContain('No payment has been taken.');
    expect(source).not.toContain('stripe.checkout.sessions.create');
  });
  it('preserves tenant isolation, immutable approval transitions and explicit UNKNOWNs', () => {
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("tenant_id=current_setting('app.tenant_id',true)");
    expect(migration).toContain('unknowns jsonb');
    expect(migration).toContain("status IN ('DRAFT','OFFERED','APPROVED','DECLINED','CANCELLED')");
  });
});
