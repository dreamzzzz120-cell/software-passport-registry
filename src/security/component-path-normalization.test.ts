import { describe, expect, it } from 'vitest';
import { normalizeComponentName, normalizeCycloneDxComponentNames } from './component-path-normalization.ts';
import { scanFindingIdentity } from './scan-finding-identity.ts';
import { scanLicenses } from '../scanners/real-repository-scanners.ts';

// The exact shape Syft emitted in production, which leaked to anonymous
// Free Review visitors and broke finding dedup across rescans.
const REAL_LEAK = '/tmp/spr-sec-job_819c9610e37b4cfeb75b03ec4865aa3c-pUG358/extracted/p-limit-df476048d023ff868cd45b35ee47f5fb0ca2b25a/.github/workflows/main.yml';
const REAL_ROOT = '/tmp/spr-sec-job_819c9610e37b4cfeb75b03ec4865aa3c-pUG358/extracted/p-limit-df476048d023ff868cd45b35ee47f5fb0ca2b25a';

describe('component path normalization', () => {
  it('1. rewrites an absolute temporary path to the repository-relative path', () => {
    expect(normalizeComponentName(REAL_LEAK, REAL_ROOT)).toBe('.github/workflows/main.yml');
  });

  it('2. removes the entire scan-specific prefix, not just a /tmp/ segment', () => {
    const normalized = normalizeComponentName(REAL_LEAK, REAL_ROOT);
    expect(normalized).not.toContain('/tmp');
    expect(normalized).not.toContain('extracted');
    expect(normalized).not.toContain('spr-sec-job');
    expect(normalized.startsWith('/')).toBe(false);
  });

  it('3. leaves genuine repository-relative and package-style names untouched', () => {
    expect(normalizeComponentName('actions/checkout', REAL_ROOT)).toBe('actions/checkout');
    expect(normalizeComponentName('lodash', REAL_ROOT)).toBe('lodash');
    expect(normalizeComponentName('.github/workflows/main.yml', REAL_ROOT)).toBe('.github/workflows/main.yml');
  });

  it('3b. is idempotent - normalizing an already-normalized value is a no-op', () => {
    const once = normalizeComponentName(REAL_LEAK, REAL_ROOT);
    expect(normalizeComponentName(once, REAL_ROOT)).toBe(once);
  });

  it('4. produces an identical finding identity across repeated scans of the same fixture', () => {
    // Each scan runs in a fresh temp dir with a different job id and random
    // suffix - the exact condition that previously minted a new identity
    // (and therefore a duplicate finding row) on every rescan.
    const scan1Root = '/tmp/spr-sec-job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-AAAAAA/extracted/p-limit-df476048d023ff868cd45b35ee47f5fb0ca2b25a';
    const scan2Root = '/tmp/spr-sec-job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-ZZZZZZ/extracted/p-limit-df476048d023ff868cd45b35ee47f5fb0ca2b25a';
    const identityFor = (root: string) => {
      const [finding] = scanLicenses(
        { bomFormat: 'CycloneDX', components: [{ name: `${root}/.github/workflows/main.yml` }] },
        root,
      );
      return scanFindingIdentity({
        tenantId: 't1', passportId: 'p1',
        engineId: finding.engineId, category: finding.category, title: finding.title, component: finding.component,
      });
    };
    expect(identityFor(scan1Root)).toBe(identityFor(scan2Root));
  });

  it('4b. still distinguishes genuinely different components', () => {
    const base = { tenantId: 't1', passportId: 'p1', engineId: 'e', category: 'License', title: 'License not observed' };
    expect(scanFindingIdentity({ ...base, component: '.github/workflows/main.yml' }))
      .not.toBe(scanFindingIdentity({ ...base, component: '.github/workflows/release.yml' }));
  });

  it('5. never leaves a job id in the normalized component, even across differing commit SHAs', () => {
    const root = '/tmp/spr-sec-job_deadbeefdeadbeefdeadbeefdeadbeef-XyZ123/extracted/repo-1111111111111111111111111111111111111111';
    const normalized = normalizeComponentName(`${root}/src/index.ts`, root);
    expect(normalized).toBe('src/index.ts');
    expect(normalized).not.toMatch(/job_|deadbeef|XyZ123|1111111/);
  });

  it('6. never returns a raw absolute path even when the scan root is missing or mismatched', () => {
    // Defensive: an unrelatable absolute path degrades to the bare file
    // name rather than disclosing the server's directory layout.
    for (const root of [undefined, '', '/some/other/root']) {
      const normalized = normalizeComponentName(REAL_LEAK, root as any);
      expect(normalized).toBe('main.yml');
      expect(normalized).not.toContain('/tmp');
      expect(normalized).not.toContain('spr-sec-job');
    }
  });

  it('6b. handles Windows-style absolute paths without leaking the drive path', () => {
    const winRoot = 'C:\\Temp\\spr-sec-job_abc\\extracted\\repo-sha';
    expect(normalizeComponentName(`${winRoot}\\src\\app.ts`, winRoot)).toBe('src/app.ts');
    expect(normalizeComponentName('C:\\Windows\\System32\\config.sys', winRoot)).toBe('config.sys');
  });

  it('7. scrubs paths from a whole CycloneDX document, including path-shaped purls', () => {
    const document = {
      bomFormat: 'CycloneDX',
      components: [
        { name: `${REAL_ROOT}/.github/workflows/main.yml`, type: 'file' },
        { name: 'actions/checkout', version: 'v4', purl: 'pkg:githubactions/actions/checkout@v4' },
        { name: `${REAL_ROOT}/weird`, purl: `${REAL_ROOT}/weird` },
      ],
    };
    const normalized = normalizeCycloneDxComponentNames(document, REAL_ROOT);
    expect(normalized.components[0].name).toBe('.github/workflows/main.yml');
    // A legitimate package purl must survive untouched - ecosystem
    // detection downstream depends on it.
    expect(normalized.components[1]).toEqual(document.components[1]);
    expect(normalized.components[2].purl).toBeUndefined();
    expect(JSON.stringify(normalized)).not.toContain('/tmp/spr-sec-job');
  });

  it('7b. leaves an empty/invalid component name alone so SBOM_INVALID validation still fires', () => {
    const document = { bomFormat: 'CycloneDX', components: [{ name: '' }, { name: 42 }] };
    const normalized = normalizeCycloneDxComponentNames(document, REAL_ROOT);
    expect(normalized.components[0].name).toBe('');
    expect(normalized.components[1].name).toBe(42);
  });

  it('7c. the license scanner emits no absolute path in either component or description', () => {
    const [finding] = scanLicenses(
      { bomFormat: 'CycloneDX', components: [{ name: `${REAL_ROOT}/.github/workflows/main.yml` }] },
      REAL_ROOT,
    );
    expect(finding.component).toBe('.github/workflows/main.yml');
    expect(finding.description).toContain('.github/workflows/main.yml');
    expect(finding.description).not.toContain('/tmp');
    expect(finding.description).not.toContain('spr-sec-job');
  });
});

describe('no scanner output field can carry an absolute server path', () => {
  it('runRealRepositoryScanners emits no temp path in any field of any finding', async () => {
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { runRealRepositoryScanners } = await import('../scanners/real-repository-scanners.ts');

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spr-sec-job_leakcheck-'));
    try {
      // A fixture that trips all three engines: a secret, an IaC risk, and
      // a license-less SBOM component named after an absolute path.
      await mkdir(path.join(tempRoot, '.github', 'workflows'), { recursive: true });
      await writeFile(path.join(tempRoot, '.github', 'workflows', 'main.yml'), 'on: push\n');
      await writeFile(path.join(tempRoot, 'config.ts'), `const t = "ghp_${'A'.repeat(30)}";\n`);
      await writeFile(path.join(tempRoot, 'deploy.yaml'), 'spec:\n  hostNetwork: true\n');

      const cycloneDx = {
        bomFormat: 'CycloneDX',
        components: [{ name: `${tempRoot}/.github/workflows/main.yml`, type: 'file' }],
      };
      const { findings } = await runRealRepositoryScanners(tempRoot, cycloneDx);

      expect(findings.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(findings);
      expect(serialized).not.toContain(tempRoot);
      expect(serialized).not.toContain(os.tmpdir());
      expect(serialized).not.toContain('spr-sec-job_leakcheck');
      for (const finding of findings) {
        expect(finding.component ?? '').not.toMatch(/^([/\\]|[A-Za-z]:[\\/])/);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('the Free Review status response never selects the free-form evidence raw_content column', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
    const source = fs.readFileSync(path.join(root, 'src/routes/free-review.ts'), 'utf8');
    expect(source).not.toContain('raw_content');
  });
});

describe('the normalization is actually wired into the scan pipeline', () => {
  it('generateRepositorySbom normalizes the document before deriving components, keeping raw Syft bytes intact', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
    const source = fs.readFileSync(path.join(root, 'src/workers/osv-worker.ts'), 'utf8');
    expect(source).toContain('normalizeCycloneDxComponentNames(parsed, scanRoot)');
    // raw must remain the untouched generator output so rawSbomHash still
    // attests to exactly what Syft produced.
    expect(source).toContain('raw: result.stdout');
  });

  it('runRealRepositoryScanners passes the scan root into the license scanner', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
    const source = fs.readFileSync(path.join(root, 'src/scanners/real-repository-scanners.ts'), 'utf8');
    expect(source).toContain('scanLicenses(cycloneDx, root)');
  });
});
