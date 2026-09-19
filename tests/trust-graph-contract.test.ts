import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR evidence lineage honesty contracts', () => {
  it('uses the five-stage evidence lineage instead of a score-oriented radial graph', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain("const STAGES: Stage[] = ['passport', 'identity', 'evidence', 'finding', 'verification'];");
    expect(graph).toContain('Passport → identity → evidence → findings → verification');
    expect(graph).not.toContain('EMPTY_VENDORS');
  });

  it('requires an explicit software identity reference before rendering an identity node', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain('passport.softwareIdentity');
    expect(graph).toContain('passport.softwareIdentityId');
    expect(graph).toContain('if (!identity && !identityId) return null;');
  });

  it('does not infer evidence relationships from ambiguous evidence IDs', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain('matches.length === 1 ? matches[0] : null');
    expect(graph).toContain('Ambiguous');
  });

  it('renders findings only when a persisted passport or resolvable evidence relationship exists', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain('if (!hasKnownPassport && knownEvidence.length === 0) return;');
    expect(graph).toContain("'has finding'");
    expect(graph).toContain("'produced finding'");
  });

  it('makes every displayed relationship inspectable with source-backed proof', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain('Relationship proof');
    expect(graph).toContain('The finding explicitly references this evidence record.');
    expect(graph).toContain('The passport contains a persisted verification status.');
    expect(graph).toContain('Absence of an edge is intentional.');
  });
});
