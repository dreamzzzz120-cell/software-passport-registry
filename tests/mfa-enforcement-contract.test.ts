import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MFA enforcement contract', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const challenge = fs.readFileSync('src/components/MfaChallengeView.tsx', 'utf8');
  const security = fs.readFileSync('src/middleware/security.ts', 'utf8');
  const auth = fs.readFileSync('src/routes/auth.ts', 'utf8');
  const admin = fs.readFileSync('src/lib/supabase-admin.ts', 'utf8');

  it('challenges an enrolled session before authenticated workspace rendering', () => {
    expect(app).toContain('getAuthenticatorAssuranceLevel()');
    expect(app).toContain("data.nextLevel === 'aal2'");
    expect(app).toContain("mfaState === 'required'");
    expect(challenge).toContain('mfa.challenge({ factorId })');
    expect(challenge).toContain('mfa.verify({ factorId, challengeId: challenge.data.id');
  });

  it('persists enforcement only after an AAL2 session', () => {
    expect(admin).toContain("typeof payload?.aal === 'string'");
    expect(auth).toContain("router.post('/auth/mfa-state'");
    expect(auth).toContain("req.user!.aal !== 'aal2'");
    expect(auth).toContain('mfaEnabled: parsed.data.enabled ? 1 : 0');
  });

  it('rejects lower-assurance API calls after MFA is enabled', () => {
    expect(security).toContain('dbUser.mfaEnabled');
    expect(security).toContain("decodedToken.aal !== 'aal2'");
    expect(security).toContain("code: 'MFA_REQUIRED'");
    expect(security).toContain("'/api/auth/mfa-state'");
  });
});
