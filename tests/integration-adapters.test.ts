import { describe, expect, it, afterEach, vi } from 'vitest';
import { collectProviderEvidence } from '../src/integrations/adapters.ts';

const fakeResponse = (body: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }) => new Response(JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe('provider evidence collectors', () => {
  it('collects GitLab identity and project evidence', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse({ id: 7, username: 'spr' })).mockResolvedValueOnce(fakeResponse({ count: 1, projects: [{ id: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectProviderEvidence('gitlab', { accessToken: 'test' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.responseHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.observation).toMatchObject({ user: { id: 7 }, sampleProjects: { count: 1 } });
  });

  it('collects Microsoft Graph organization evidence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ value: [{ id: 'tenant-1' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectProviderEvidence('microsoft-365', { accessToken: 'test' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('graph.microsoft.com/v1.0/organization');
    expect(result.verificationMethod).toContain('Microsoft Graph');
  });

  it('rejects missing provider credentials before network access', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(collectProviderEvidence('hudu', {})).rejects.toThrow('CREDENTIAL_MISSING');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('produces signed AWS STS evidence instead of declaring AWS unsupported', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ GetCallerIdentityResponse: { GetCallerIdentityResult: { Account: '123456789012' } } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectProviderEvidence('aws', { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret', region: 'us-east-1' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(result.responseHash).toMatch(/^sha256:/);
  });

  it('fails closed on oversized provider responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'.repeat(2_000_001), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(collectProviderEvidence('slack', { accessToken: 'test' })).rejects.toThrow('PROVIDER_RESPONSE_TOO_LARGE');
  });

  it('blocks localhost and private provider URLs before network access', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(collectProviderEvidence('gitlab', { accessToken: 'test', baseUrl: 'https://127.0.0.1:8443' })).rejects.toThrow('PROVIDER_URL_BLOCKED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks provider URLs that resolve to private addresses', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(collectProviderEvidence('gitlab', { accessToken: 'test', baseUrl: 'https://127.0.0.1.example.invalid' })).rejects.toThrow(/PROVIDER_URL_(BLOCKED|RESOLVES_PRIVATE)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow redirects to a private address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(collectProviderEvidence('microsoft-365', { accessToken: 'test' })).rejects.toThrow('PROVIDER_URL_BLOCKED');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
