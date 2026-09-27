import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('self-service MSP launch onboarding', () => {
  it('keeps the launch checklist visible after the five core setup steps complete', () => {
    const onboarding = read('src/components/OnboardingView.tsx');
    expect(onboarding).toContain("import MSPLaunchChecklist from './MSPLaunchChecklist'");
    expect(onboarding).toContain('<MSPLaunchChecklist onNavigateTab={onNavigateTab} onContinue={onComplete} />');

    const pilotStart = onboarding.indexOf('<PilotOnboardingChecklist');
    const pilotEnd = onboarding.indexOf('/>', pilotStart);
    const pilotProps = onboarding.slice(pilotStart, pilotEnd);
    expect(pilotProps).not.toContain('onComplete=');
  });

  it('derives launch readiness from persisted tenant-scoped endpoints, never browser completion flags', () => {
    const launch = read('src/components/MSPLaunchChecklist.tsx');
    for (const endpoint of [
      "/api/organization/team",
      "/api/organization/branding",
      "/api/monitoring/monitoring-configurations",
      "/api/user/passports",
      "/api/integrations-live",
    ]) {
      expect(launch).toContain(endpoint);
    }
    expect(launch).toContain('/history?type=executive');
    expect(launch).toContain('/customers');
    expect(launch).not.toContain('localStorage');
    expect(launch).not.toContain('sessionStorage');
  });

  it('covers the self-service launch surfaces an MSP needs without an operator-only action', () => {
    const launch = read('src/components/MSPLaunchChecklist.tsx');
    for (const path of ['/team', '/integrations', '/monitoring', '/white-label', '/reports']) {
      expect(launch).toContain(`path: '${path}'`);
    }
    expect(launch).toContain('No SPR operator action is required.');
  });

  it('only marks provider customer setup complete from an actual mapped provider customer', () => {
    const launch = read('src/components/MSPLaunchChecklist.tsx');
    expect(launch).toContain("new Set(['connectwise', 'autotask', 'ninjaone', 'hudu'])");
    expect(launch).toContain("rows.filter((row: any) => Boolean(row?.client_id)).length");
    expect(launch).toContain("complete: (state.mappedCustomers ?? 0) > 0");
  });

  it('treats staff and branding as skippable for solo MSPs rather than artificial blockers', () => {
    const launch = read('src/components/MSPLaunchChecklist.tsx');
    expect(launch).toContain('A solo MSP may skip team and branding steps and return later.');
    expect(launch).toContain('Continue to dashboard');
  });
});
