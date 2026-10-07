import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MFA login enforcement contract', () => {
  const login = fs.readFileSync('src/components/LoginView.tsx', 'utf8');

  it('checks authenticator assurance level before entering the workspace', () => {
    expect(login).toContain('supabase.auth.mfa.getAuthenticatorAssuranceLevel()');
    expect(login).toContain("nextLevel === 'aal2'");
    expect(login).toContain("currentLevel !== 'aal2'");
  });

  it('requires a verified TOTP factor and verifies a challenge', () => {
    expect(login).toContain("item.status === 'verified'");
    expect(login).toContain('supabase.auth.mfa.challenge');
    expect(login).toContain('supabase.auth.mfa.verify');
    expect(login).toContain('Verify and continue');
  });

  it('does not call onLoginSuccess until AAL2 is satisfied', () => {
    const start = login.indexOf('const finishSession');
    const end = login.indexOf('useEffect(() =>', start);
    const flow = login.slice(start, end);
    expect(flow.indexOf("nextLevel === 'aal2'")).toBeLessThan(flow.indexOf('onLoginSuccess('));
    expect(flow).toContain('return;');
  });
});
