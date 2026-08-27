import { describe, expect, it } from 'vitest';

// Real production issue: every Vercel deploy of this project (preview or
// production) gets its own unique-hash subdomain
// (e.g. software-passport-registry-ff1zu4h0c-sprteam.vercel.app), which
// can't be enumerated in APP_ALLOWED_ORIGINS ahead of time. Two real users
// hit "CORS origin denied" (a 500) from these preview URLs before this was
// added. The regex must accept any such team-owned preview host while
// rejecting lookalike/spoofing attempts.
const VERCEL_TEAM_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+-sprteam\.vercel\.app$/i;

describe('VERCEL_TEAM_PREVIEW_ORIGIN', () => {
  it('accepts real per-deployment preview origins for this team', () => {
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('https://software-passport-registry-ff1zu4h0c-sprteam.vercel.app')).toBe(true);
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('https://software-passport-registry-vercel-h46keihxa-sprteam.vercel.app')).toBe(true);
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('https://software-passport-registry-vercel-git-main-sprteam.vercel.app')).toBe(true);
  });

  it('does not need to match the stable production alias (already in the exact allowlist)', () => {
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('https://software-passport-registry-vercel.vercel.app')).toBe(false);
  });

  it('rejects a suffix-spoofing attempt using the team name as a subdomain prefix elsewhere', () => {
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('https://evil-sprteam.vercel.app.attacker.com')).toBe(false);
  });

  it('rejects a different team slug', () => {
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('https://software-passport-registry-ff1zu4h0c-otherteam.vercel.app')).toBe(false);
  });

  it('rejects non-HTTPS', () => {
    expect(VERCEL_TEAM_PREVIEW_ORIGIN.test('http://software-passport-registry-ff1zu4h0c-sprteam.vercel.app')).toBe(false);
  });
});
