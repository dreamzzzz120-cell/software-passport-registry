import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRACKER_JS } from '../src/routes/software-registry.ts';

describe('server-rendered /software pages record page views', () => {
  const src = readFileSync(new URL('../src/routes/software-registry.ts', import.meta.url), 'utf8');

  it('every page layout loads the same-origin tracker', () => {
    expect(src).toContain('<script src="/software/track.js" defer></script>');
  });

  it('serves the tracker before the /:owner/:repository catch', () => {
    expect(src.indexOf("router.get('/track.js'")).toBeGreaterThan(-1);
    expect(src.indexOf("router.get('/track.js'")).toBeLessThan(src.indexOf("router.get('/:owner/:repository'"));
  });

  it('tracker is valid JS, posts to the traffic endpoint, and shares the SPA session key', () => {
    expect(() => new Function(TRACKER_JS)).not.toThrow();
    expect(TRACKER_JS).toContain('/api/traffic/event');
    expect(TRACKER_JS).toContain("'spr-analytics-session'");
    const analytics = readFileSync(new URL('../src/analytics.ts', import.meta.url), 'utf8');
    expect(analytics).toContain("'spr-analytics-session'");
  });

  it('tracker payload matches the server event schema', () => {
    const sent: any[] = [];
    const store = new Map<string, string>();
    const g: any = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      crypto: { randomUUID: () => '0123456789abcdef0123456789abcdef' },
      location: { pathname: '/software/acme/widget', search: '' },
      innerWidth: 500,
      document: { referrer: 'https://www.google.com/' },
      navigator: { sendBeacon: (url: string, blob: any) => { sent.push({ url, blob }); return true; } },
      Blob: class { parts: any[]; constructor(p: any[]) { this.parts = p; } },
      fetch: () => Promise.resolve(),
    };
    new Function(...Object.keys(g), TRACKER_JS)(...Object.values(g));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/traffic/event');
    const body = JSON.parse(sent[0].blob.parts[0]);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(body).toMatchObject({ path: '/software/acme/widget', referrer: 'https://www.google.com/', deviceType: 'mobile' });
  });
});
