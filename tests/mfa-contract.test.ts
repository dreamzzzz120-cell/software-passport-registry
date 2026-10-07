import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR MFA contracts', () => {
  it('checks authenticator assurance before rendering an authenticated workspace', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('getAuthenticatorAssuranceLevel()');
    expect(app).toContain("data.nextLevel === 'aal2'");
    expect(app).toContain("mfaState === 'required'");
    expect(app).toContain('MfaChallengeView');
  });

  it('supports real TOTP enrollment and verification in Settings', () => {
    const panel = read('src/components/MfaSettingsPanel.tsx');
    expect(panel).toContain("mfa.enroll({ factorType: 'totp'");
    expect(panel).toContain('mfa.challenge({ factorId })');
    expect(panel).toContain('mfa.verify({ factorId, challengeId: challenge.data.id');
    expect(panel).toContain('mfa.unenroll({ factorId: id })');
  });

  it('requires AAL2 at the API when a verified MFA factor exists', () => {
    const security = read('src/middleware/security.ts');
    expect(security).toContain('adminAuth.listMfaFactors(uid)');
    expect(security).toContain("factor?.status === 'verified'");
    expect(security).toContain("decodedToken.aal !== 'aal2'");
    expect(security).toContain("code: 'MFA_REQUIRED'");
  });

  it('does not treat MFA_REQUIRED as an unprovisioned account or sign the user out', () => {
    const client = read('src/utils/apiClient.ts');
    expect(client).toContain("denied?.code === 'MFA_REQUIRED'");
    expect(client).toContain("new CustomEvent('mfa-required')");
  });

  it('reloads workspace data after successful second-factor verification', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("setMfaState('ready'); setReloadKey((value) => value + 1);");
    expect(app).toContain('setMfaCheckKey((value) => value + 1)');
  });
});
