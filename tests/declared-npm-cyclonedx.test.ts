import { describe, expect, it } from 'vitest';
import { includeUnresolvedNpmDeclarations } from '../src/workers/declared-npm-cyclonedx.ts';
import { isLicenceEvaluable } from '../src/scanners/real-repository-scanners.ts';

describe('customer-visible unresolved npm declarations', () => {
  it('exposes declared dependencies without inventing versions or vulnerability eligibility', () => {
    const doc = includeUnresolvedNpmDeclarations(
      { bomFormat: 'CycloneDX', components: [{ type: 'library', name: 'debug', version: '4.4.1', purl: 'pkg:npm/debug@4.4.1' }] },
      [{ name: 'debug', declaredRange: '^4.4.0' }, { name: 'accepts', declaredRange: '^2.0.0' }],
    );
    expect(doc.components).toHaveLength(2);
    const unresolved = doc.components.find(c => c.name === 'accepts')!;
    expect(unresolved.version).toBeUndefined();
    expect(unresolved.purl).toBeUndefined();
    expect(unresolved.properties).toContainEqual({ name: 'spr:dependency:declared-range', value: '^2.0.0' });
    expect(isLicenceEvaluable(unresolved)).toBe(false);
  });
  it('keeps declarations visible when Syft finds only GitHub Actions', () => {
    const doc = includeUnresolvedNpmDeclarations(
      { components: [{ type: 'library', name: 'actions/checkout', version: 'v4', purl: 'pkg:github/actions/checkout@v4' }] },
      [{ name: 'express', declaredRange: '^5.0.0' }],
    );
    expect(doc.components.map(c => c.name)).toEqual(['actions/checkout', 'express']);
  });
});
