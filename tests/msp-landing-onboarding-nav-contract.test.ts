import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('public /msp landing page reuses existing pricing and billing, without duplicating either', () => {
  it('MspLandingView exists and links its CTAs into the existing login/pricing flow, not a new one', () => {
    const s = read('src/components/MspLandingView.tsx');
    expect(s).toContain('onEnter: () => void');
    expect(s).toContain('onViewPricing: () => void');
    expect(s).not.toContain('stripe');
    expect(s).not.toContain('PLAN_CONFIG');
  });

  it('App.tsx serves MspLandingView at /msp for unauthenticated visitors without touching the authenticated /msp route', () => {
    const s = read('src/App.tsx');
    // Asserts /msp specifically rather than pinning the whole PUBLIC_PATHS
    // literal, so an unrelated public route cannot break this guarantee.
    const publicPathsLine = s.split('\n').find((l) => l.includes('const PUBLIC_PATHS = new Set(')) ?? '';
    expect(publicPathsLine).toContain("'/msp'");
    expect(s).toContain("if (!user && path === '/msp') return <MspLandingView onEnter={() => navigate('/login')} onViewPricing={() => navigate('/pricing')} />;");
    // Asserts the authenticated /msp route still renders MSPCommandCenter,
    // without pinning the full prop list - that made the test break on any
    // unrelated prop addition rather than on the behaviour it guards.
    expect(s).toContain("case '/msp': view = <MSPCommandCenter");
    expect(s).toContain('clients={clients} alerts={alerts} passports={passports} role={role}');
  });
});

describe('first-run onboarding banner on the dashboard', () => {
  const source = () => read('src/components/EvidenceDashboardView.tsx');

  it('is gated strictly on the real clients list being empty, not a separate persisted onboarding flag', () => {
    const s = source();
    expect(s).toContain('{clients.length === 0 && (');
  });

  it('is actionable through the existing onOpenQuickAction/onNavigateTab handlers, not a dead button', () => {
    const s = source();
    const bannerStart = s.indexOf('{clients.length === 0 && (');
    const bannerEnd = s.indexOf(')}\n    <section className="spr-panel p-6 md:p-9">');
    const banner = s.slice(bannerStart, bannerEnd);
    expect(banner).toContain("onOpenQuickAction('add-client')");
    expect(banner).toContain("onNavigateTab('/integrations')");
  });
});

describe('MSP Command Center is the primary nav entry point, with every other nav item preserved', () => {
  const source = () => read('src/components/CommandCenter.tsx');

  it('msp is the first item in CORE, not in EXECUTIVE', () => {
    const s = source();
    const coreStart = s.indexOf('const CORE: NavItem[] = [');
    const coreEnd = s.indexOf('];', coreStart);
    const core = s.slice(coreStart, coreEnd);
    expect(core.indexOf("id: 'msp'")).toBeGreaterThan(-1);
    expect(core.indexOf("id: 'msp'")).toBeLessThan(core.indexOf("id: 'dashboard'"));

    const execStart = s.indexOf('const EXECUTIVE: NavItem[] = [');
    const execEnd = s.indexOf('];', execStart);
    const exec = s.slice(execStart, execEnd);
    expect(exec).not.toContain("id: 'msp'");
  });

  it('preserves every other existing nav entry across all groups', () => {
    const s = source();
    for (const id of [
      'dashboard', 'assets', 'passports', 'coverage', 'evidence-explorer', 'scans', 'monitoring', 'alerts', 'clients', 'trust-graph',
      'security', 'compliance', 'audit-log', 'vendors', 'questionnaires', 'governance', 'privacy', 'integrations', 'reports',
      'savings', 'agent-trust', 'ai-trust-center', 'enterprise-readiness', 'investor', 'founder',
      'team', 'extensions', 'billing', 'settings',
    ]) {
      expect(s).toContain(`id: '${id}'`);
    }
  });
});
