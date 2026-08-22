import { describe, expect, it, vi, beforeEach } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }));

import { validateWebhookUrl } from './webhook-url';

describe('webhook URL SSRF protection', () => {
  beforeEach(() => lookup.mockReset());

  it.each([
    'http://example.com/hook',
    'https://example.com:8443/hook',
    'https://user:pass@example.com/hook',
    'https://example.com/hook#fragment',
    'https://localhost/hook',
    'https://foo.localhost/hook',
    'https://foo.local/hook',
    'https://foo.internal/hook',
    'https://127.0.0.1/hook',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(validateWebhookUrl(url)).rejects.toThrow();
  });

  it('rejects a hostname with any blocked DNS answer', async () => {
    lookup.mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(validateWebhookUrl('https://example.com/hook')).rejects.toThrow(/blocked network/);
  });

  it('rejects IPv4-mapped IPv6 private destinations', async () => {
    lookup.mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }]);
    await expect(validateWebhookUrl('https://example.com/hook')).rejects.toThrow(/blocked network/);
  });

  it('accepts a public hostname whose complete DNS set is public', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.toBeInstanceOf(URL);
  });
});
