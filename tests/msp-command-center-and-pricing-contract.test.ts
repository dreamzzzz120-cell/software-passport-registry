import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR MSP Command Center — software verification metrics', () => {
  const source = () => read('src/components/MSPCommandCenter.tsx');

  it('receives real passport records as a prop instead of deriving software counts from clients/alerts alone', () => {
    const s = source();
    expect(s).toContain('passports: SoftwarePassport[]');
    expect(s).toContain('export default function MSPCommandCenter({ clients, alerts, passports');
  });

  it('counts verified vs unknown software from the real verificationStatus field, not a fabricated default', () => {
    const s = source();
    expect(s).toContain("passport.verificationStatus === 'verified'");
    expect(s).not.toContain('verified: true');
  });

  it('never coerces an empty portfolio into a 0% coverage or freshness figure', () => {
    const s = source();
    expect(s).toContain('const coveragePct = total > 0 ? Math.round((verified / total) * 100) : null;');
    expect(s).toContain('const freshnessPct = total > 0 ? Math.round((freshEvidence / total) * 100) : null;');
    expect(s).toContain('softwareVerification.total > 0 ? (');
    expect(s).toContain('No software assets on record yet.');
    expect(s).toContain('evidenceCoverage.total > 0 ? (');
    expect(s).toContain('No data — no evidence has been recorded yet.');
  });

  it('derives evidence freshness from real evidence timestamps, not a hardcoded window', () => {
    const s = source();
    expect(s).toContain('EVIDENCE_FRESHNESS_WINDOW_DAYS');
    expect(s).toContain("item?.timestamp ? Date.parse(item.timestamp) : NaN");
    expect(s).toContain('Number.isNaN(value)');
  });

  it('provides a real client switcher wired to the existing onSelectClient/onNavigate handlers, not a decorative dropdown', () => {
    const s = source();
    expect(s).toContain('Switch client');
    expect(s).toContain('onSelectClient(client.id); onNavigate(\'clients\')');
  });
});

describe('SPR MSP pricing — packaging separated from live billing', () => {
  const source = () => read('src/components/MspPricingView.tsx');

  it('is honest that checkout runs through Stripe and that client-limits (not every feature) are actually enforced', () => {
    const s = source();
    expect(s).toContain('Actual checkout runs through Stripe inside your authenticated workspace');
    expect(s).toContain('Client-environment limits shown\n          above are enforced by the application once a plan is active');
  });

  it('shows the real, specified prices for each tier, matching PLAN_CONFIG', () => {
    const s = source();
    expect(s).toContain("priceLabel: '$499/month'");
    expect(s).toContain("priceLabel: '$1,499/month'");
    expect(s).toContain("priceLabel: '$2,999/month'");
    expect(s).toContain("priceLabel: '$5,000+/month (custom)'");
  });

  it('does not fabricate a live Stripe price or plan id', () => {
    const s = source();
    expect(s).not.toMatch(/price_[A-Za-z0-9]+/);
    expect(s).not.toContain('stripe.checkout.sessions.create');
  });

  it('routes both authenticated and unauthenticated /pricing to the same real MSP pricing view', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("if (!user && path === '/pricing') return <MspPricingView isAuthenticated={false}");
    expect(app).toContain("case '/pricing': view = <MspPricingView isAuthenticated={true}");
  });
});
