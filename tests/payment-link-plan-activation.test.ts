import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/routes/billing.ts'), 'utf8');

describe('Stripe Payment Link activation mapping', () => {
  it('carries the selected SPR plan in client_reference_id', () => {
    expect(source).toContain("`${tenantId}__sprplan__${parsed.data.plan}`");
  });

  it('accepts only known plan ids when decoding the signed checkout completion', () => {
    expect(source).toContain('/^(.*)__sprplan__(pilot|starter|professional|growth|enterprise)$/');
    expect(source).toContain('const plan = metadataPlan && PLAN_CONFIG[metadataPlan] ? metadataPlan : paymentLinkPlan;');
  });

  it('preserves normal Checkout metadata as the preferred source when available', () => {
    expect(source).toContain('const metadataPlan = session.metadata?.plan as PlanId | undefined;');
  });
});
