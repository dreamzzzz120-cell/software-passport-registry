// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/supabase-auth', () => ({
  auth: { currentUser: null },
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } },
}));
import { apiFetch } from '../src/utils/apiClient';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('public registry survives unpaid workspace requests', () => {
  it.each(['/registry', '/registry/'])('preserves %s and the denied API response', async (path) => {
    window.history.replaceState({}, '', path);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'SUBSCRIPTION_REQUIRED' }), { status: 402 })));
    const response = await apiFetch('/api/user/passports');
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED' });
    expect(window.location.pathname).toBe(path);
  });

  it('still routes an unpaid private workspace to billing', async () => {
    window.history.replaceState({}, '', '/passports');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'SUBSCRIPTION_REQUIRED' }), { status: 402 })));
    expect((await apiFetch('/api/user/passports')).status).toBe(402);
    expect(window.location.pathname).toBe('/billing');
    expect(window.location.search).toBe('?reason=subscription');
  });
});
