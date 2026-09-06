import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// SettingsView had accumulated several real fabrications, each a control or
// stat that looked live and load-bearing but had zero backend behind it.
describe('SettingsView no longer fabricates security/infrastructure status', () => {
  const source = () => read('src/components/SettingsView.tsx');

  it('SAML/SSO is honestly disclosed as not implemented, not shown as permanently "Active" with a fake pre-filled Okta provider/client ID', () => {
    const s = source();
    expect(s).not.toContain("useState('Okta Enterprise IdP')");
    expect(s).not.toContain("useState('spr_msp_okta_prod_01')");
    expect(s).not.toContain("{ssoEnabled ? 'SSO Active' : 'SSO Inactive'}");
    expect(s).toContain('Not yet implemented. There is no SAML/SSO enforcement anywhere in the authentication pipeline today');
  });

  it('the audit-chain "Tamper-Proof SLA verified" badge is state-driven from a real verification result, not shown unconditionally on page load', () => {
    const s = source();
    expect(s).not.toContain('Tamper-Proof SLA verified');
    expect(s).toContain("verificationResult?.isValid === true ? 'Verified this session'");
  });

  it('the SLA alert-threshold slider and daily-recalculation toggle are honestly disclosed as unimplemented, not shown as live controls with no backend', () => {
    const s = source();
    expect(s).not.toContain('type="range"');
    expect(s).not.toContain('defaultChecked');
    expect(s).toContain('no per-tenant alert threshold is configurable or read by the alert pipeline today');
    expect(s).toContain('no scheduled job re-scans client inventory on CVE database updates today');
  });

  it('the PGP signing key section is honestly disclosed as unimplemented, not a button with no onClick handler and a false passport-signing claim', () => {
    const s = source();
    expect(s).not.toContain('Regenerate Sign Key');
    expect(s).toContain('generated Software Passports and audit attestations are not cryptographically signed today');
  });

  it('platform status shows real fetched uptime instead of a hardcoded fake SLA percentage and version string', () => {
    const s = source();
    expect(s).not.toContain('SPR-CORE-VM');
    expect(s).not.toContain('DOCKER PROD v2.4');
    expect(s).not.toContain('99.98%');
    expect(s).toContain("fetch('/health').then((r) => r.json())");
  });

  it('the Product Bible library discloses it is local-only, session-scoped reference data, not synced or wired to the real scanning pipeline', () => {
    const s = source();
    expect(s).not.toContain('Automated daily RSS synchronizations');
    expect(s).toContain('This library is local to your current session only');
  });
});
