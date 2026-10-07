import { describe, expect, it } from 'vitest';

import { readCode as read } from './helpers/source-contract.ts';

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
    expect(s).toContain("if (!user && path === '/msp') return <MspLandingView onEnter={() => navigate('/free-review')} onViewPricing={() => navigate('/pricing')} />;");
    // The authenticated /msp route is now the evidence-backed MSP Operations
    // Command Center. The detailed legacy MSPCommandCenter remains embedded
    // inside it, so this test follows the actual route boundary rather than
    // requiring the wrapper to be the leaf component.
    expect(s).toContain("case '/msp': view = <MSPOperationsCommandCenter");
    expect(s).toContain('clients={clients} alerts={alerts} passports={passports} role={role}');
  });
});

describe('first-run onboarding banner on the dashboard', () => {
  const source = () => read('src/components/EvidenceDashboardView.tsx');

  // The dashboard no longer gates the checklist on clients.length === 0: that
  // hid steps 2-5 the moment step 1 was done (observed live 2026-09-19). The
  // checklist hides itself only when every step's real, saved-data status is
  // complete; there is still no persisted "onboarding dismissed" flag.
  it('is rendered by the dashboard without a clients-empty gate or a persisted onboarding flag', () => {
    const s = source();
    expect(s).not.toContain('{clients.length === 0 && (');
    expect(s).not.toMatch(/onboarding(Dismissed|Complete|Seen)/i);
    expect(s).toContain('<PilotOnboardingChecklist');
  });

  it('hides itself only once every real step is complete', () => {
    const s = read('src/components/PilotOnboardingChecklist.tsx');
    expect(s).toContain('const completedCount = tasks.filter(t => t.status).length;');
    expect(s).toContain('if (completedCount === tasks.length) return null;');
    expect(s).not.toMatch(/localStorage/);
  });

  it('passes its own real onOpenQuickAction/onNavigateTab handlers into PilotOnboardingChecklist, not stubs', () => {
    const s = source();
    const bannerStart = s.indexOf('<PilotOnboardingChecklist');
    const bannerEnd = s.indexOf('<section className="spr-panel p-6 md:p-9">');
    const banner = s.slice(bannerStart, bannerEnd);
    expect(banner).toContain('<PilotOnboardingChecklist');
    expect(banner).toContain('onOpenQuickAction={onOpenQuickAction}');
    expect(banner).toContain('onNavigateTab={onNavigateTab}');
  });

  it("'register-passport' opens New Review, the only place a passport is created", () => {
    const s = read('src/App.tsx');
    expect(s).toContain("action === 'register-passport' ? '/extensions/new-review'");
  });

  it('PilotOnboardingChecklist actually calls the handlers it is given, so the banner is not a dead button', () => {
    const s = read('src/components/PilotOnboardingChecklist.tsx');
    expect(s).toContain("onOpenQuickAction('add-client')");
    expect(s).toContain("onNavigateTab(activeTab === 'integrations' ? '/integrations' : '/billing')");
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
