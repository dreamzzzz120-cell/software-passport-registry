import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production session and evidence continuity', () => {
  const apiClient = fs.readFileSync('src/utils/apiClient.ts', 'utf8');
  const auth = fs.readFileSync('src/lib/supabase-auth.ts', 'utf8');
  const explorer = fs.readFileSync('src/components/EvidenceExplorerView.tsx', 'utf8');
  const app = fs.readFileSync('src/App.tsx', 'utf8');

  it('does not sign an established user out when /api/user/me returns 403', () => {
    const profileBlock = apiClient.slice(
      apiClient.indexOf("response.status === 403 && resolvedUrl.pathname === '/api/user/me'"),
      apiClient.indexOf('return response;', apiClient.indexOf("response.status === 403 && resolvedUrl.pathname === '/api/user/me'")),
    );
    expect(profileBlock).not.toContain('auth.signOut');
    expect(profileBlock).toContain('auth-profile-unavailable');
  });

  it('only clears a confirmed Supabase identity on an explicit SIGNED_OUT event', () => {
    expect(auth).toContain("if (event === 'SIGNED_OUT')");
    expect(auth).toContain("if (session?.user)");
    expect(auth).toContain("if (!hydrated && event === 'INITIAL_SESSION')");
  });

  it('recovers the Passport selector directly instead of claiming no passports were loaded', () => {
    expect(explorer).toContain("apiFetch('/api/user/passports')");
    expect(explorer).toContain('Passport list unavailable');
    expect(explorer).toContain('No passports recorded');
    expect(explorer).not.toContain('No passports loaded');
  });

  it('keeps the selected Passport wired through the evidence route', () => {
    expect(app).toContain('selectedPassportId={selectedPassportId}');
    expect(app).toContain('onSelectPassportId={setSelectedPassportId}');
  });
});
