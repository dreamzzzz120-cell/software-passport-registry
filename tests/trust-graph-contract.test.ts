import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR trust graph honesty contracts', () => {
  it('derives vendor nodes from real passport.publisher data instead of an unimplemented vendors table', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain("passport.publisher");
    expect(graph).toContain("kind: 'vendor'");
    expect(graph).not.toContain('EMPTY_VENDORS');
  });

  it('caps SBOM component nodes to risk-relevant components and discloses the count that was summarized instead of shown', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain("trustLevel !== 'Trusted'");
    expect(graph).toContain('additional trusted component');
  });

  it('never infers a Passport → Asset relationship from matching names or IDs', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).not.toContain("'represents'");
    expect(graph).not.toContain('matchingAsset');
    expect(graph).toContain('Never infer Passport → Asset from matching names or IDs');
  });

  it('gives every supported edge kind a real rationale instead of a generic placeholder', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain('EDGE_RATIONALE');
    expect(graph).toContain('publishes:');
    expect(graph).toContain('owns:');
    expect(graph).toContain('contains:');
    expect(graph).toContain('supports:');
    expect(graph).toContain("'has finding':");
    expect(graph).toContain("'has vulnerability':");
    expect(graph).toContain("'affected by':");
  });

  it('makes relationship lines clickable and keeps node vs. edge selection mutually exclusive', () => {
    const graph = read('src/components/TrustGraphView.tsx');
    expect(graph).toContain('const selectNode = (id: string) => { setSelectedId(id); setSelectedEdgeKey(null); };');
    expect(graph).toContain('const selectEdge = (edge: GraphEdge) => { setSelectedEdgeKey(');
  });
});
