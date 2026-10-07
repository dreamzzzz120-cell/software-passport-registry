import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MFA login enforcement with password recovery', () => {
  const login = fs.readFileSync('src/components/LoginView.tsx', 'utf8');

  it('keeps password recovery isolated from normal workspace entry', () => {
    expect(login).toContain('if (recoveryRequested.current) return;');
    expect(login).toContain("event === 'PASSWORD_RECOVERY'");
    expect(login).toContain("mode === 'recovery'");
  });

  it('checks assurance level before entering an MFA-protected workspace', () => {
    expect(login).toContain('supabase.auth.mfa.getAuthenticatorAssuranceLevel()');
    expect(login).toContain("nextLevel === 'aal2'");
    expect(login).toContain("currentLevel !== 'aal2'");
    const start = login.indexOf('const finishSession');
    const end = login.indexOf('useEffect(() =>', start);
    const flow = login.slice(start, end);
    expect(flow.indexOf("nextLevel === 'aal2'")).toBeLessThan(flow.indexOf('onLoginSuccess('));
  });

  it('uses a verified TOTP challenge for the second factor', () => {
    expect(login).toContain("item.status === 'verified'");
    expect(login).toContain('supabase.auth.mfa.challenge');
    expect(login).toContain('supabase.auth.mfa.verify');
    expect(login).toContain('Verify and continue');
  });
});
