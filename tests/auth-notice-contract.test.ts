import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAuthNotice, consumeAuthNotice } from '../src/lib/authNotice.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

function installFakeSessionStorage() {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  return store;
}

// Regression test for the bug where an authoritative /api/user/me 401 or a
// provisioning 403 (apiClient.ts, unprovisioned identity) signed the
// user out and navigated to /login with zero explanation: the failure was
// detected while the authenticated shell was still mounted, so a live
// window event fired before the fresh LoginView instance existed to hear
// it. setAuthNotice/consumeAuthNotice persist the message across that
// remount via sessionStorage instead.
describe('auth notice survives the sign-out + navigate-to-login remount', () => {
  beforeEach(() => { installFakeSessionStorage(); });

  it('round-trips a message', () => {
    setAuthNotice('Your session could not be verified. Please sign in again.');
    expect(consumeAuthNotice()).toBe('Your session could not be verified. Please sign in again.');
  });

  it('is one-time: a second read after consumption returns null', () => {
    setAuthNotice('one-time message');
    expect(consumeAuthNotice()).toBe('one-time message');
    expect(consumeAuthNotice()).toBeNull();
  });

  it('returns null when nothing was ever set', () => {
    expect(consumeAuthNotice()).toBeNull();
  });

  it('never throws when storage is unavailable (private browsing, disabled site data)', () => {
    (globalThis as any).sessionStorage = undefined;
    expect(() => setAuthNotice('x')).not.toThrow();
    expect(consumeAuthNotice()).toBeNull();
  });
});

describe('the notice is actually wired into both failure paths', () => {
  it("App.tsx only lets the authoritative /api/user/me 401 invalidate the global session", () => {
    const source = read('src/App.tsx');
    const branchStart = source.indexOf('if (me.status === 401)');
    expect(branchStart).toBeGreaterThan(-1);
    const branch = source.slice(branchStart, branchStart + 500);
    expect(branch).toContain('setAuthNotice(');
    expect(branch).toContain('await signOut(auth)');
    expect(branch.indexOf('setAuthNotice(')).toBeLessThan(branch.indexOf('navigate('));

    // Regression guard: an auxiliary scans/findings/passports/clients/
    // integrations/vendors 401 must never be treated as proof that the
    // browser's authenticated identity is invalid.
    expect(source).not.toContain('responses.some((response) => response.status === 401)');
  });

  it("apiClient.ts's provisioning-failure 403 branch sets a notice before signing out", () => {
    const source = read('src/utils/apiClient.ts');
    const branchStart = source.indexOf("resolvedUrl.pathname === '/api/user/me'");
    expect(branchStart).toBeGreaterThan(-1);
    const branch = source.slice(branchStart, branchStart + 1400);
    expect(branch).toContain('setAuthNotice(');
    expect(branch.indexOf('setAuthNotice(')).toBeLessThan(branch.indexOf('auth.signOut('));
  });

  it('LoginView consumes the pending notice on mount', () => {
    expect(read('src/components/LoginView.tsx')).toContain('consumeAuthNotice()');
  });
});
