import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeCopy } from '../src/lib/distribution-outreach.ts';
import { countryFromRequest } from '../src/routes/traffic.ts';

describe('MSP outreach copy', () => {
  it('offers a white-label client report, not a review of their own repo', () => {
    const c = makeCopy('SFY IT', { signals: { compliance: true } }, false);
    expect(c.subject).toBe("White-label software risk reports for SFY IT's clients");
    const body = c.intro.join(' ');
    expect(body).toContain('Hi SFY IT team,');
    expect(body).toContain('under your logo');
    expect(body).toContain('compliance work');
    expect(body).toContain('15 minutes');
    expect(body).not.toMatch(/came across your business|repo review/i);
  });

  it('matches the fit line to observed signals and handles a missing company', () => {
    expect(makeCopy('', { signals: { cybersecurity: true } }, false).intro.join(' ')).toContain('security services');
    const none = makeCopy('', {}, false);
    expect(none.subject).toBe('White-label software risk reports for your clients');
    expect(none.intro[0]).toBe('Hi there,');
  });

  it('follow-up restates the offer and points at the opt-out', () => {
    const f = makeCopy('KCC', {}, true);
    expect(f.subject).toBe('Free client software report for KCC');
    expect(f.intro.join(' ')).toMatch(/opt-out link/);
    expect(f.subject.startsWith('Re:')).toBe(false);
  });
});

describe('traffic country', () => {
  it('reads the Vercel country passed through the rewrite, and rejects junk', () => {
    expect(countryFromRequest({ headers: {}, query: { vc_country: 'CA' } })).toBe('CA');
    expect(countryFromRequest({ headers: { 'x-vercel-ip-country': 'US' }, query: {} })).toBe('US');
    expect(countryFromRequest({ headers: {}, query: { vc_country: ['CA', 'US'] } })).toBeNull();
    expect(countryFromRequest({ headers: {}, query: { vc_country: 'ca' } })).toBeNull();
    expect(countryFromRequest({ headers: {}, query: {} })).toBeNull();
  });

  it('vercel.json captures the country before the generic /api proxy', () => {
    const rewrites = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).rewrites as any[];
    const geo = rewrites.findIndex((r) => r.source === '/api/traffic/event');
    const generic = rewrites.findIndex((r) => r.source === '/api/:path*');
    expect(geo).toBeGreaterThan(-1);
    expect(geo).toBeLessThan(generic);
    expect(rewrites[geo].has[0]).toMatchObject({ type: 'header', key: 'x-vercel-ip-country' });
    expect(rewrites[geo].destination).toMatch(/\/api\/traffic\/event\?vc_country=:country$/);
  });
});

describe('Supabase admin key', () => {
  it('accepts the new-style secret key as well as the legacy service-role key', () => {
    const src = readFileSync(new URL('../src/lib/supabase-admin.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\) \|\| process\.env\.SUPABASE_SECRET_KEY/);
    const conn = readFileSync(new URL('../src/lib/server/founder/connections.ts', import.meta.url), 'utf8');
    expect(conn).toMatch(/SUPABASE_SECRET_KEY/);
  });
});
