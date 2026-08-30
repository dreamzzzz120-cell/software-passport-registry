import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const design = read('src/components/design/CommandCenter.tsx');
const css = read('src/styles/command-center.css');
const stripComments = (s: string) => s.split(String.fromCharCode(10))
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
  .join(String.fromCharCode(10));

describe('design primitives are presentation-only', () => {
  it('contain no evaluator logic or policy constants', () => {
    const code = stripComments(design);
    for (const forbidden of ['evaluateVerification', 'minThirdPartySources', 'maxAgeDays',
      'requiresPinnedTarget', 'VERIFICATION_POLICY', 'trustScore', 'riskLevel', 'complianceProgress']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('introduce no unsafe type escapes', () => {
    for (const p of ['@ts-ignore', '@ts-expect-error', 'as unknown as']) {
      expect(design, p).not.toContain(p);
    }
    expect(stripComments(design)).not.toMatch(/:\s*any\b/);
  });

  it('render every one of the five authoritative states', () => {
    for (const state of ['VERIFIED', 'PARTIAL', 'INVESTIGATE', 'AVOID', 'UNKNOWN']) {
      expect(design, state).toContain(state);
      expect(css, state).toContain(`.cc-decision-${state}`);
    }
  });

  it('never upgrade an absent decision into a real state', () => {
    expect(design).toContain("state ? `cc-decision-${state}` : 'cc-decision-UNKNOWN'");
    expect(design).toContain("{state ?? 'NOT EVALUATED'}");
  });
});

describe('UNKNOWN is treated as deliberate, not as failure', () => {
  it('gets a real hue rather than a muted grey-out', () => {
    expect(css).toContain('--cc-unknown:');
    // Same bloom recipe as every other state - no reduced treatment.
    expect(css).toContain('.cc-decision-UNKNOWN     { --glow: var(--cc-unknown); }');
  });

  it('is described as a legitimate conclusion, not a safety verdict', () => {
    expect(design).toContain('This is not a statement that the software is unsafe');
  });
});

describe('accessibility and motion', () => {
  it('never relies on colour or glow alone - state text always renders', () => {
    expect(design).toContain('aria-label={`Decision: ${copy.label}`}');
    expect(design).toContain("{state ?? 'NOT EVALUATED'}");
  });

  it('gates motion behind prefers-reduced-motion and keeps focus visible', () => {
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(css).toContain('focus-visible');
  });
});

describe('evidence stays distinguishable from decisions', () => {
  it('evidence cards are labelled Observed, not given a decision badge', () => {
    const card = design.slice(design.indexOf('export function EvidenceCard'));
    expect(card).toContain('Observed');
    expect(card).not.toContain('DecisionBadge');
  });

  it('the hero reports observations separately from unique evidence and sources', () => {
    expect(design).toContain('label="Observations"');
    expect(design).toContain('label="Unique evidence"');
    expect(design).toContain('label="Independent sources"');
  });
});

describe('Trust Room consumes the authoritative decision verbatim', () => {
  it('passes the evaluator explanation and reason codes into the hero', () => {
    const tr = read('src/components/trust/TrustRoom.tsx');
    expect(tr).toContain('<DecisionHero');
    expect(tr).toContain('explanation={verificationExplanation}');
    expect(tr).toContain('reasonCodes={verificationReasonCodes}');
    expect(tr).not.toContain('evaluateVerification');
  });
});
