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
    expect(home).not.toContain('View Sample Passport');
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

describe('the public sample Passport no longer contains fabricated data', () => {
  it('explicitly tells visitors that sample data was removed', () => {
    expect(demo).toContain('No sample data');
    expect(demo).toContain('SPR no longer displays a fabricated sample Passport');
    expect(demo).toContain('actual observations');
  });

  it('points visitors to a real review instead of illustrative results', () => {
    expect(demo).toContain('See a real Software Passport instead.');
    expect(demo).toContain('Run a Free Review');
  });

  it('performs no network, database or tenant access', () => {
    const code = stripComments(demo);
    for (const forbidden of ['apiFetch', 'fetch(', 'db.execute', 'tenant_id', 'req.user', 'attachTenantScope', 'localStorage', 'sessionStorage']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('computes no decision and contains no fabricated verification state', () => {
    const code = stripComments(demo);
    for (const forbidden of ['evaluateVerification', 'minThirdPartySources', 'state="PARTIAL"', 'state="VERIFIED"', "state: 'UNKNOWN'", 'BUILD_PROVENANCE', 'EvidenceCard']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('exposes no secret, credential or real customer identifier', () => {
    for (const forbidden of ['sk_live', 'price_1', 'postgres://', 'SPR_PUBLIC_PASSPORT_SECRET', 'Bearer ']) {
      expect(demo, forbidden).not.toContain(forbidden);
    }
  });
});

describe('routing keeps the public boundary explicit', () => {
  it('keeps the legacy sample path exact rather than widening the public boundary', () => {
    expect(app).toContain("'/passport/demo'");
    expect(app).toContain("if (path === '/passport/demo') return <DemoPassport");
    expect(app).not.toContain("startsWith('/passport/')");
  });

  it('does not expose authenticated navigation to anonymous visitors', () => {
    const idx = app.indexOf("path === '/passport/demo'");
    expect(app.slice(idx, idx + 200)).not.toContain('CommandCenter');
  });
});
