import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackPageView } from '../src/analytics';

describe('traffic delivery observability', () => {
  const fetchMock = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { pathname: '/', search: '' },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    vi.stubGlobal('document', { referrer: '' });
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends a keepalive POST and accepts a successful 202 without warnings', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 });
    trackPageView('/pricing');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/traffic/event');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ path: '/pricing', eventName: 'page_view' });
    await vi.waitFor(() => expect(warn).not.toHaveBeenCalled());
  });

  it('reports HTTP rejection by status only', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    trackPageView('/pricing');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[SPR traffic] Event not accepted by API', 503));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports network failure without retrying or logging visitor data', async () => {
    fetchMock.mockRejectedValue(new Error('sensitive transport failure'));
    trackPageView('/pricing');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[SPR traffic] Event delivery could not be confirmed'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
  });
});
