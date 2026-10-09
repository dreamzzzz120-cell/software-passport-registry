import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const panel = fs.readFileSync(path.join(root, 'src/components/FounderControlPlane.tsx'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'src/components/FounderOverview.tsx'), 'utf8');

describe('Founder revenue presentation truth', () => {
  it('does not label subscription MRR as cash collected', () => {
    expect(panel).toContain('Subscription MRR (not collected revenue)');
    expect(panel).toContain('subscription MRR (not collected cash)');
    expect(overview).toContain('Subscription MRR estimate (not collected cash)');
  });

  it('keeps payment evidence distinct from active subscriptions', () => {
    expect(panel).toContain('successfulPaymentAmount30dCents');
    expect(overview).toContain('Successful Stripe payments · 30d');
    expect(panel).toContain('A 100% discount may leave an active subscription with $0 paid.');
  });
});
