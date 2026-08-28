import { describe, expect, it, afterEach, vi } from 'vitest';
import { collectDeepProviderEvidence } from '../src/integrations/deep-collectors.ts';

const fakeResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

// Microsoft 365 / Defender security evidence, added to close the gap the
// PSA/RMM/Security Integration Layer spec calls "Microsoft 365 / Defender"
// (priority #3) -- identity evidence already existed; this adds the actual
// Defender/Graph Security posture (alerts, secure score, recommendations)
// on the same provider and OAuth token, per Microsoft's own Graph Security
// API surface, not a separate fabricated "Defender connector".
describe('collectDeepProviderEvidence: microsoft-365 Defender/security evidence', () => {
  it('collects all six microsoft-365 controls, including the three new Defender/security ones', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectDeepProviderEvidence('microsoft-365', { accessToken: 'test' });
    const controlIds = result.map((r) => r.controlId);
    expect(controlIds).toEqual([
      'm365-global-admin-inventory', 'm365-user-mfa-signal', 'm365-conditional-access',
      'm365-security-alerts', 'm365-secure-score', 'm365-secure-score-recommendations',
    ]);
  });

  it('calls the real, documented Graph Security API endpoints, not an invented one', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await collectDeepProviderEvidence('microsoft-365', { accessToken: 'test' });
    const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.some((u) => u.includes('graph.microsoft.com/v1.0/security/alerts_v2'))).toBe(true);
    expect(urls.some((u) => u.includes('graph.microsoft.com/v1.0/security/secureScores'))).toBe(true);
    expect(urls.some((u) => u.includes('graph.microsoft.com/v1.0/security/secureScoreControlProfiles'))).toBe(true);
  });

  it('flags open Defender/Graph Security alerts as FAIL, and a clean alert feed as PASS', async () => {
    const withAlerts = vi.fn(async (url: string) => url.includes('alerts_v2') ? fakeResponse({ value: [{ id: 'a1' }] }) : fakeResponse({ value: [] }));
    vi.stubGlobal('fetch', withAlerts);
    const result = await collectDeepProviderEvidence('microsoft-365', { accessToken: 'test' });
    expect(result.find((r) => r.controlId === 'm365-security-alerts')!.status).toBe('FAIL');
    vi.unstubAllGlobals();

    const noAlerts = vi.fn(async () => fakeResponse({ value: [] }));
    vi.stubGlobal('fetch', noAlerts);
    const result2 = await collectDeepProviderEvidence('microsoft-365', { accessToken: 'test' });
    expect(result2.find((r) => r.controlId === 'm365-security-alerts')!.status).toBe('PASS');
  });

  it('never turns a numeric secure score into a fabricated pass/fail judgment -- PASS only means evidence was collected', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ value: [{ currentScore: 12, maxScore: 100 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectDeepProviderEvidence('microsoft-365', { accessToken: 'test' });
    const secureScore = result.find((r) => r.controlId === 'm365-secure-score')!;
    expect(secureScore.status).toBe('PASS');
    expect(secureScore.limitation).toMatch(/does not establish pass\/fail/i);
  });

  it('fails closed to UNKNOWN, never a fabricated clean posture, when the token lacks Security API permission', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('/security/') ? new Response(JSON.stringify({ error: { code: 'Authorization_RequestDenied' } }), { status: 403 }) : fakeResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectDeepProviderEvidence('microsoft-365', { accessToken: 'test-insufficient-scope' });
    expect(result.find((r) => r.controlId === 'm365-security-alerts')!.status).toBe('UNKNOWN');
    expect(result.find((r) => r.controlId === 'm365-secure-score')!.status).toBe('UNKNOWN');
    expect(result.find((r) => r.controlId === 'm365-secure-score-recommendations')!.status).toBe('UNKNOWN');
  });

  it('does not add any controls for an unrelated provider', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await collectDeepProviderEvidence('slack' as any, { accessToken: 'test' });
    expect(result.some((r) => r.controlId.startsWith('m365-'))).toBe(false);
  });
});
