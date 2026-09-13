import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeHostname, publicBrandingView, RESERVED_HOST_SUFFIXES } from '../src/routes/custom-domains.ts';
import { dnsInstructions } from '../src/lib/server/vercel-domains.ts';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('custom domain hostnames', () => {
  it('accepts a fully-qualified hostname the tenant controls and normalises it', () => {
    expect(normalizeHostname('  Trust.Example.COM. ')).toBe('trust.example.com');
    expect(normalizeHostname('portal.acme-msp.co.uk')).toBe('portal.acme-msp.co.uk');
  });

  it.each(['softwarepassportregistry.com', 'app.softwarepassportregistry.com', 'foo.vercel.app', 'x.railway.app', 'localhost', 'not a host', 'http://a.b', 'single', '-bad.example.com'])('rejects %s', (input) => {
    expect(normalizeHostname(input)).toBeNull();
  });

  it('reserves every hostname SPR itself is served from', () => {
    for (const suffix of ['softwarepassportregistry.com', 'vercel.app']) expect(RESERVED_HOST_SUFFIXES).toContain(suffix);
  });
});

describe('DNS instructions come from the provider, not from guesses', () => {
  it('subdomains get a CNAME, apex domains an A record, and provider challenges pass through untouched', () => {
    const sub = dnsInstructions('trust.example.com', { name: 'trust.example.com', apexName: 'example.com', verified: false, verification: [{ type: 'TXT', domain: '_vercel.example.com', value: 'vc-domain-verify=abc', reason: 'pending_domain_verification' }] });
    expect(sub[0]).toMatchObject({ type: 'CNAME', name: 'trust.example.com', value: 'cname.vercel-dns.com' });
    expect(sub[1]).toMatchObject({ type: 'TXT', name: '_vercel.example.com', value: 'vc-domain-verify=abc' });
    const apex = dnsInstructions('example.com', { name: 'example.com', apexName: 'example.com', verified: true });
    expect(apex).toEqual([expect.objectContaining({ type: 'A', value: '76.76.21.21' })]);
  });
});

describe('activation is the provider’s answer, never an assumption', () => {
  const routes = read('src/routes/custom-domains.ts');

  it('status becomes active only when Vercel reports verified and not misconfigured', () => {
    expect(routes).toContain('const active = verified && !misconfigured && !lastError;');
    expect(routes).toContain("const status = lastError ? 'error' : active ? 'active' : 'pending_dns';");
  });

  it('sign-in enablement at the identity provider is tracked separately and its failure surfaced', () => {
    expect(routes).toContain('await addAuthorizedDomain(hostname); signInEnabled = true;');
    expect(routes).toContain('signInError = error instanceof Error');
    expect(read('src/components/CustomDomainsPanel.tsx')).toContain('sign-in not yet enabled');
  });

  it('refuses honestly when the hosting provider is not configured', () => {
    expect(routes).toContain("'CUSTOM_DOMAINS_NOT_CONFIGURED'");
    expect(routes).toContain('Nothing was saved.');
  });

  it('is gated on the white_label capability and Owner role', () => {
    expect(routes).toContain("router.post('/organization/domains', domainLimiter, requireAuth, requireRole('Owner')");
    expect(routes).toContain("enforceCapability(req, res, 'white_label')");
  });
});

describe('host-based branding', () => {
  it('exposes display packaging only', () => {
    const view = publicBrandingView({ companyName: 'Acme', brandColor: '#112233', logoDataUrl: 'data:image/png;base64,AAAA', theme: { productName: 'Acme Trust', colors: { light: { accent: '#abcdef', border: 'not-a-colour' } }, hideSprAttribution: true } });
    expect(view.theme.productName).toBe('Acme Trust');
    expect(view.theme.colors.light).toEqual({ accent: '#abcdef' });
    expect(JSON.stringify(view)).not.toMatch(/tenant/i);
  });

  it('the app asks for it on non-SPR hosts and the sign-in page renders it', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("apiFetch(`/api/public/branding/by-host?host=${encodeURIComponent(host)}`)");
    expect(app).toContain('brand={hostBrand}');
    expect(read('src/components/LoginView.tsx')).toContain('`Sign in to ${brand.productName}`');
  });

  it('the white-label page no longer says custom domains are not implemented', () => {
    expect(read('src/components/WhiteLabelView.tsx')).not.toContain('are not implemented');
    expect(read('src/components/WhiteLabelView.tsx')).toContain('<CustomDomainsPanel role={role} />');
    expect(read('src/components/SettingsView.tsx')).not.toContain('Custom domains</strong> — not implemented');
  });
});
