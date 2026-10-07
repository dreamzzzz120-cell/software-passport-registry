import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('capability paywall guidance', () => {
  it('returns the plans that include a denied capability', () => {
    const s = read('src/security/entitlements.ts');
    expect(s).toContain('function plansIncludingCapability');
    expect(s).toContain('availablePlans = plansIncludingCapability(capability)');
    expect(s).toContain("error: 'CAPABILITY_NOT_INCLUDED'");
  });

  it('preserves structured 402 context when routing to billing', () => {
    const s = read('src/utils/apiClient.ts');
    expect(s).toContain("code === 'CAPABILITY_NOT_INCLUDED'");
    expect(s).toContain("params.set('reason', 'capability')");
    expect(s).toContain("params.set('required', capability)");
    expect(s).toContain("params.set('plans', availablePlans.join(','))");
    expect(s).toContain("params.set('reason', 'subscription')");
  });

  it('shows a capability-specific upgrade banner instead of a generic billing bounce', () => {
    const s = read('src/components/BillingView.tsx');
    expect(s).toContain("if (reason === 'capability')");
    expect(s).toContain('is not included in your current plan');
    expect(s).toContain('MSP Professional');
    expect(s).toContain('MSP Business');
    expect(s).toContain('Enterprise');
  });

  it('keeps lapsed or unpaid subscription guidance separate from tier upgrade guidance', () => {
    const s = read('src/components/BillingView.tsx');
    expect(s).toContain("if (reason === 'subscription')");
    expect(s).toContain('Workspace access is locked because the subscription is');
    expect(s).toContain('An active SPR subscription is required to unlock the MSP workspace.');
  });
});
