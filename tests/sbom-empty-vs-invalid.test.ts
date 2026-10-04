import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { declaredNpmDependenciesFromPackageJson, mergeDeclaredNpmDependencies, normalizeCycloneDx } from '../src/workers/osv-worker.ts';

// Observed in production: jonschlinkert/is-odd (package.json, no lockfile)
// was acquired and extracted, Syft exited 0, and the job failed with
// SBOM_INVALID. Syft's CycloneDX encoder omits "components" when it resolved
// nothing. That is an empty SBOM -- a statement about the repository -- not a
// malformed document, and the customer must be told which.

describe('CycloneDX normalization distinguishes empty from invalid', () => {
  it('treats a CycloneDX document with no components key as SBOM_EMPTY, not SBOM_INVALID', () => {
    expect(() => normalizeCycloneDx({ bomFormat: 'CycloneDX', specVersion: '1.6' })).toThrow('SBOM_EMPTY');
  });

  it('treats an explicitly empty components array as SBOM_EMPTY', () => {
    expect(() => normalizeCycloneDx({ bomFormat: 'CycloneDX', components: [] })).toThrow('SBOM_EMPTY');
  });

  it('still rejects a present but non-array components value, a wrong bomFormat, and a nameless component as SBOM_INVALID', () => {
    expect(() => normalizeCycloneDx({ bomFormat: 'CycloneDX', components: 'nope' })).toThrow('SBOM_INVALID');
    expect(() => normalizeCycloneDx({ bomFormat: 'SPDX', components: [] })).toThrow('SBOM_INVALID');
    expect(() => normalizeCycloneDx({ bomFormat: 'CycloneDX', components: [{ name: '' }] })).toThrow('SBOM_INVALID');
    expect(() => normalizeCycloneDx(null)).toThrow('SBOM_INVALID');
  });

  it('normalizes a real component list unchanged', () => {
    const components = normalizeCycloneDx({ bomFormat: 'CycloneDX', components: [{ name: 'is-number', version: '6.0.0', purl: 'pkg:npm/is-number@6.0.0' }] });
    expect(components).toEqual([{ name: 'is-number', version: '6.0.0', ecosystem: 'npm', purl: 'pkg:npm/is-number@6.0.0' }]);
  });
});

describe('Free Review tells the customer why nothing was assessed', () => {
  const source = fs.readFileSync('src/routes/free-review-legacy.ts', 'utf8');
  it('maps SBOM_EMPTY and NO_SUPPORTED_MANIFESTS to honest, non-internal reasons', () => {
    expect(source).toMatch(/SBOM_EMPTY:\s*'[^']*no lockfile[^']*'/);
    expect(source).toMatch(/NO_SUPPORTED_MANIFESTS:\s*'[^']*no dependency manifest[^']*'/);
    // Neither message may imply an SPR-side outage or leak an internal path/tool.
    for (const code of ['SBOM_EMPTY', 'NO_SUPPORTED_MANIFESTS']) {
      const message = source.match(new RegExp(`${code}:\\s*'([^']*)'`))![1];
      expect(message).not.toMatch(/syft|cyclonedx|worker|internal|\/tmp|C:\\\\/i);
      expect(message).toMatch(/No evidence was collected/);
    }
  });
});


describe('package.json declared dependency evidence', () => {
  it('preserves dependency ranges when no lockfile can resolve an installed version', () => {
    const declared = declaredNpmDependenciesFromPackageJson({
      dependencies: { accepts: '^2.0.0', debug: '^4.4.0' },
      devDependencies: { mocha: '^11.7.5' },
    });
    expect(declared).toEqual([
      { name: 'accepts', ecosystem: 'npm', declaredRange: '^2.0.0', resolution: 'declared' },
      { name: 'debug', ecosystem: 'npm', declaredRange: '^4.4.0', resolution: 'declared' },
      { name: 'mocha', ecosystem: 'npm', declaredRange: '^11.7.5', resolution: 'declared' },
    ]);
  });

  it('does not replace a resolved Syft package with a package.json range', () => {
    const merged = mergeDeclaredNpmDependencies(
      [{ name: 'debug', version: '4.4.1', ecosystem: 'npm', purl: 'pkg:npm/debug@4.4.1' }],
      [
        { name: 'debug', ecosystem: 'npm', declaredRange: '^4.4.0', resolution: 'declared' },
        { name: 'accepts', ecosystem: 'npm', declaredRange: '^2.0.0', resolution: 'declared' },
      ],
    );
    expect(merged).toContainEqual({ name: 'debug', version: '4.4.1', ecosystem: 'npm', purl: 'pkg:npm/debug@4.4.1', resolution: 'resolved' });
    expect(merged).toContainEqual({ name: 'accepts', ecosystem: 'npm', declaredRange: '^2.0.0', resolution: 'declared' });
    expect(merged.filter((component) => component.name === 'debug')).toHaveLength(1);
  });

  it('never gives an unresolved declaration a fake installed version', () => {
    const declared = declaredNpmDependenciesFromPackageJson({ dependencies: { express: '^5.2.1' } });
    const merged = mergeDeclaredNpmDependencies([], declared);
    expect(merged[0]).toMatchObject({ name: 'express', declaredRange: '^5.2.1', resolution: 'declared' });
    expect(merged[0].version).toBeUndefined();
    expect(merged[0].purl).toBeUndefined();
  });
});
