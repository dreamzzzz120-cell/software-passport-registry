import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const home = read('src/components/HomePage.tsx');
const demo = read('src/components/DemoPassport.tsx');
const app = read('src/App.tsx');
const stripComments = (s: string) => s.split(String.fromCharCode(10))
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
  .join(String.fromCharCode(10));

describe('homepage presents the product without evaluating anything', () => {
  it('leads with the value proposition and the Free Review as primary CTA', () => {
    expect(home).toContain('Verify software before you trust it.');
    expect(home).toContain('Run a Free Review');
    expect(home).toContain('View Sample Passport');
  });

  it('replaces the generic asset taxonomy with concrete buyer questions', () => {
    expect(home).not.toContain('FRAGMENTED_SOURCES');
    expect(home).toContain('BUYER_QUESTIONS');
    expect(home).toContain('What remains UNKNOWN?');
  });

  it('gives UNKNOWN equal standing and never equates it with unsafe', () => {
    expect(home).toContain('UNKNOWN is a real answer');
    expect(home).toContain('does not mean safe, and it does not mean unsafe');
  });

  it('states that SPR does not invent certainty', () => {
    expect(home).toContain('does not invent');
  });

  it('declares limited early access rather than production readiness', () => {
    expect(home).toContain('Limited early access');
    for (const claim of ['Production Ready', 'Certified', 'Guaranteed', 'SOC 2', 'ISO 27001']) {
      expect(home, claim).not.toContain(claim);
    }
  });

  it('invents no social proof', () => {
    for (const fake of ['customers trust', 'testimonial', 'Trusted by', 'G2 ', 'Fortune 500']) {
      expect(home, fake).not.toContain(fake);
    }
  });

  it('calculates no verification state', () => {
    const code = stripComments(home);
    for (const forbidden of ['evaluateVerification', 'minThirdPartySources', 'maxAgeDays', 'trustScore', 'riskLevel']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the public sample Passport is safe by construction', () => {
  it('is explicitly labelled as demonstration data, more than once', () => {
    expect(demo).toContain('Demo · Sample data');
    expect(demo).toContain('sample Passport for demonstration only');
    expect((demo.match(/DemoBanner \/>/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('performs no network, database or tenant access', () => {
    const code = stripComments(demo);
    for (const forbidden of ['apiFetch', 'fetch(', 'db.execute', 'tenant_id', 'req.user', 'attachTenantScope', 'localStorage', 'sessionStorage']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('computes no decision - every state is a literal', () => {
    const code = stripComments(demo);
    expect(code).not.toContain('evaluateVerification');
    expect(code).not.toContain('minThirdPartySources');
    expect(code).toContain('state="PARTIAL"');
  });

  it('illustrates a state the policy can actually produce, and keeps UNKNOWN visible', () => {
    // A glowing VERIFIED would misrepresent the product: nothing reaches
    // VERIFIED under policy 1.0.0 without a publisher attestation.
    expect(demo).not.toContain('state="VERIFIED"');
    expect(demo).toContain("state: 'UNKNOWN'");
    expect(demo).toContain('BUILD_PROVENANCE');
  });

  it('keeps observations distinct from the decision', () => {
    expect(demo).toContain('Repeated\n            observations of the same source are not independent corroboration');
    expect(demo).toContain('EvidenceCard');
  });

  it('exposes no secret, credential or real customer identifier', () => {
    for (const forbidden of ['sk_live', 'price_1', 'postgres://', 'SPR_PUBLIC_PASSPORT_SECRET', 'Bearer ']) {
      expect(demo, forbidden).not.toContain(forbidden);
    }
  });
});

describe('routing keeps the public boundary explicit', () => {
  it('adds only the exact /passport/demo path to the public set', () => {
    expect(app).toContain("'/passport/demo'");
    expect(app).toContain("if (path === '/passport/demo') return <DemoPassport");
    // Not a wildcard: no other /passport/* path becomes public.
    expect(app).not.toContain("startsWith('/passport/')");
  });

  it('does not expose authenticated navigation to anonymous visitors', () => {
    // The demo renders standalone, outside the authenticated CommandCenter shell.
    const idx = app.indexOf("path === '/passport/demo'");
    expect(app.slice(idx, idx + 200)).not.toContain('CommandCenter');
  });

  it('is crawlable and listed, unlike tokenized result links', () => {
    expect(read('public/robots.txt')).toContain('Allow: /passport/demo');
    expect(read('public/sitemap.xml')).toContain('/passport/demo');
    expect(read('public/robots.txt')).toContain('Disallow: /free-review/result');
  });
});
