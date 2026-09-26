import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({ default: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } }));

import { researchUrl, contactPageCandidates, RESEARCH_VERSION } from '../src/lib/distribution-engine.ts';

type Route = { status: number; body?: string; location?: string };
let routes: Record<string, Route>;
let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url] ?? { status: 404, body: 'not found' };
    const headers = new Headers(r.location ? { location: r.location } : {});
    return new Response(r.body ?? '', { status: r.status, headers });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const home = (extra = '') => `<html><head><title>Acme IT</title></head><body>Managed IT services and cybersecurity for local businesses. <a href="/about">About</a> <a href="/get-in-touch/contact">Contact us</a>${extra}</body></html>`;

describe('research v2', () => {
  it('follows apex -> www and finds the role address on the linked contact page', async () => {
    routes = {
      'https://acme.ca/': { status: 301, location: 'https://www.acme.ca/' },
      'https://www.acme.ca/': { status: 200, body: home() },
      'https://www.acme.ca/get-in-touch/contact': { status: 200, body: '<p>Email info@acme.ca or call us.</p>' },
    };
    const r: any = await researchUrl('https://acme.ca/');
    expect(r.publicRoleEmails).toEqual(['info@acme.ca']);
    expect(r.contactPage).toBe('https://www.acme.ca/get-in-touch/contact');
    // Contacts are saved under, and the send step looks them up by, the queued URL.
    expect(r.url).toBe('https://acme.ca/');
    expect(r.finalUrl).toBe('https://www.acme.ca/');
    expect(r.signals.msp).toBe(true);
    expect(r.researchVersion).toBe(RESEARCH_VERSION);
  });

  it('does not fetch a contact page when the home page already has an address', async () => {
    routes = { 'https://acme.ca/': { status: 200, body: home(' sales@acme.ca') } };
    const r: any = await researchUrl('https://acme.ca/');
    expect(r.publicRoleEmails).toEqual(['sales@acme.ca']);
    expect(calls).toEqual(['https://acme.ca/']);
  });

  it('never follows a redirect to another site', async () => {
    routes = { 'https://acme.ca/': { status: 302, location: 'https://parked-domains.example/' } };
    const r: any = await researchUrl('https://acme.ca/');
    expect(r.redirected).toBe(true);
    expect(r.publicRoleEmails).toBeUndefined();
    expect(calls).toEqual(['https://acme.ca/']);
  });

  it('falls back to /contact then /contact-us, at most two extra fetches', async () => {
    routes = {
      'https://acme.ca/': { status: 200, body: '<title>Acme</title>Managed IT services' },
      'https://acme.ca/contact-us': { status: 200, body: 'hello@acme.ca' },
    };
    const r: any = await researchUrl('https://acme.ca/');
    expect(r.publicRoleEmails).toEqual(['hello@acme.ca']);
    expect(calls).toEqual(['https://acme.ca/', 'https://acme.ca/contact', 'https://acme.ca/contact-us']);
  });

  it('only proposes same-origin contact pages', () => {
    const c = contactPageCandidates(new URL('https://acme.ca/'), '<a href="https://evil.example/contact">x</a><a href="mailto:x@y.z">m</a>');
    expect(c.map(String)).toEqual(['https://acme.ca/contact', 'https://acme.ca/contact-us']);
  });
});

describe('re-research bookkeeping', () => {
  it('treats a domain as researched by the version that ran it, not the one that queued it', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/workers/distribution-worker.ts', import.meta.url), 'utf8');
    const q = src.slice(src.indexOf('async function knownResearchDomains'), src.indexOf('async function sweepDiscovery'));
    expect(q).toContain(`(result->>'researchVersion')::text = '2'`);
    expect(q).toContain(`status IN ('queued','running')`);
    expect(q).not.toContain(`payload->>'rv' = '2'`);
  });
});

describe('send hand-off safety', () => {
  it('sweeps recent, active, never-emailed researched contacts only', async () => {
    const { UNSENT_CONTACT_SQL } = await import('../src/workers/distribution-worker.ts');
    for (const part of [`c.status='active'`, `c.source_url IS NOT NULL`, `INTERVAL '10 minutes'`, `INTERVAL '14 days'`, `m.kind='initial' AND m.status='sent'`, `j.kind='send_outreach'`, `LIMIT 25`]) expect(UNSENT_CONTACT_SQL).toContain(part);
  });

  it('serialises sends per contact and makes the sweep single-flight', async () => {
    const { readFileSync } = await import('node:fs');
    const outreach = readFileSync(new URL('../src/lib/distribution-outreach.ts', import.meta.url), 'utf8');
    expect(outreach.slice(outreach.indexOf('export async function sendInitial'))).toMatch(/FROM distribution_contacts WHERE id=\$1 AND tenant_id=\$2 LIMIT 1 FOR UPDATE/);
    const worker = readFileSync(new URL('../src/workers/distribution-worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain(`pg_try_advisory_xact_lock(hashtext('spr-distribution-unsent-sweep'))`);
  });
});
