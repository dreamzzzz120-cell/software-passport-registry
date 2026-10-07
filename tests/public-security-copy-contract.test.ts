import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public security copy accuracy', () => {
  const dynamic = fs.readFileSync('src/components/PublicTrustCenterView.tsx', 'utf8');
  const staticPage = fs.readFileSync('public/security/index.html', 'utf8');

  it('names the active Supabase identity provider and not the retired Firebase wording', () => {
    expect(dynamic).toContain('Supabase Auth');
    expect(staticPage).toContain('Supabase Auth');
    expect(dynamic).not.toContain('Firebase Authentication issues sign-in tokens');
    expect(staticPage).not.toContain('Authentication is handled through Firebase Authentication');
  });

  it('publishes the complete current workspace role set', () => {
    expect(dynamic).toContain('Owner, Admin, Operator, Technician, Viewer, Client');
  });

  it('keeps MFA wording scoped to enrollment rather than claiming every account is protected', () => {
    expect(dynamic).toContain('TOTP authenticator MFA can be enrolled per account');
    expect(staticPage).toContain('TOTP authenticator enrollment available per account');
  });
});
