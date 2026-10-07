import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TOTP MFA settings contract', () => {
  const settings = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');

  it('supports real Supabase TOTP enrollment, challenge, verification and removal', () => {
    expect(settings).toContain('supabase.auth.mfa.listFactors()');
    expect(settings).toContain("factorType: 'totp'");
    expect(settings).toContain('supabase.auth.mfa.challenge');
    expect(settings).toContain('supabase.auth.mfa.verify');
    expect(settings).toContain('supabase.auth.mfa.unenroll');
  });

  it('does not claim MFA is available without verification', () => {
    expect(settings).toContain('Closing this panel without verification does not enable the factor.');
    expect(settings).toContain('Authenticator MFA is enabled for this account.');
    expect(settings).not.toContain('Not available. SPR does not currently offer authenticator');
  });

  it('never sends the authenticator secret to an SPR API endpoint', () => {
    const start = settings.indexOf('const beginTotpEnrollment');
    const end = settings.indexOf('const removeTotpFactor');
    const flow = settings.slice(start, end);
    expect(flow).not.toContain("apiFetch(");
    expect(settings).toContain('SPR never stores your authenticator secret');
  });
});
