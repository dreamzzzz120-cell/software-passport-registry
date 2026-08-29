import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('TrustStateBadge maps only the real backend verificationStatus values', () => {
  const source = () => read('src/components/trust/TrustStateBadge.tsx');

  it('has exactly one mapping function, with no invented intermediate states', () => {
    const s = source();
    expect(s).toContain("if (status === 'verified') return 'VERIFIED';");
    expect(s).toContain("if (status === 'partial') return 'PARTIALLY_VERIFIED';");
    expect(s).toContain("return 'EVIDENCE_INCOMPLETE';");
  });

  it('never equates missing evidence with an unsafe/negative claim in the displayed label or description text', () => {
    const s = source();
    expect(s).toContain('Absence of evidence is never presented as a negative finding');
    const metaBlockStart = s.indexOf('const STATE_META');
    const metaBlockEnd = s.indexOf('\n};', metaBlockStart);
    const displayedText = s.slice(metaBlockStart, metaBlockEnd);
    expect(displayedText).not.toMatch(/unsafe|insecure|dangerous/i);
  });
});

describe('TrustField never fabricates a dimension value', () => {
  const source = () => read('src/components/trust/TrustField.tsx');

  it('renders "N/A" for any dimension whose value is null, never a placeholder number', () => {
    const s = source();
    expect(s).toContain('const known = dimension.value !== null;');
    expect(s).toContain("{known ? dimension.value : 'N/A'}");
  });

  it('the dashed/neutral line and node styling is driven by the same null check, not a separate guess', () => {
    const s = source();
    expect(s).toContain("dimension.value === null ? BORDER");
    expect(s).toContain("strokeDasharray={known ? undefined : '3 3'}");
  });

  it('carries a demo flag that visibly labels illustrative data as example data', () => {
    const s = source();
    expect(s).toContain('demo = false');
    expect(s).toContain('Example data');
  });

  it('every value has a plain-text fallback for accessibility, not just the SVG', () => {
    const s = source();
    expect(s).toContain('className="sr-only"');
    expect(s).toContain("dimension.value === null ? 'Not available' : dimension.value");
  });

  it('the pulse animation is gated on prefers-reduced-motion', () => {
    const s = source();
    expect(s).toContain('@media (prefers-reduced-motion: no-preference)');
  });
});

describe('HomePage only shows the real 4 scoring-engine dimensions, not a fabricated 12', () => {
  const source = () => read('src/components/HomePage.tsx');

  it('passes demo to TrustField, since no authenticated Passport data exists on a public page', () => {
    const s = source();
    expect(s).toMatch(/<TrustField\s+demo/);
  });

  it('lists exactly security, compliance, vendor reputation, and confidence -- the fields scoring-engine.ts actually computes', () => {
    const s = source();
    expect(s).toContain("key: 'security'");
    expect(s).toContain("key: 'compliance'");
    expect(s).toContain("key: 'vendor'");
    expect(s).toContain("key: 'confidence'");
    // The other 8 labels from the mockup TrustOSView.tsx must not appear here.
    for (const fabricated of ['AI Governance', 'Resilience', 'Reputation', 'Transparency', 'Supply Chain', 'Provenance', 'Integrity', 'Reliability']) {
      expect(s).not.toContain(fabricated);
    }
  });

  it('CTAs route to real, existing paths only', () => {
    const s = read('src/App.tsx');
    expect(s).toContain("onCreatePassport={() => navigate('/login')}");
    expect(s).toContain("onExploreTrustNetwork={() => navigate('/free-review')}");
  });
});
