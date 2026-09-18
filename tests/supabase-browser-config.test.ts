import { afterEach, describe, expect, it, vi } from 'vitest';

// src/lib/supabase reads its project URL and publishable key from the build
// environment (inlined by vite.config.ts). These tests load the module fresh
// under each environment so they exercise that contract rather than whatever
// happens to be in the test runner's process.env.
async function loadWith(env: { url?: string; key?: string }) {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', env.url ?? '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', env.key ?? '');
  return import('../src/lib/supabase');
}

describe('Supabase browser configuration', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('is configured from VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY', async () => {
    const mod = await loadWith({ url: 'https://example.supabase.co', key: 'sb_publishable_test' });
    expect(mod.supabaseConfigured).toBe(true);
    expect(mod.supabase.auth).toBeDefined();
  });

  it('reports itself unconfigured and refuses to build a client when either value is absent', async () => {
    const noKey = await loadWith({ url: 'https://example.supabase.co' });
    expect(noKey.supabaseConfigured).toBe(false);
    expect(() => noKey.supabase.auth).toThrow(/not configured/);

    const noUrl = await loadWith({ key: 'sb_publishable_test' });
    expect(noUrl.supabaseConfigured).toBe(false);
  });

  it('does not carry a hard-coded Supabase project in source', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/);
    expect(source).not.toMatch(/sb_publishable_/);
  });
});
