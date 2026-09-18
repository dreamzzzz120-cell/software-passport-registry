import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  applyCatalogLocations, applyContentInspection, categorizeFile, computeCoverage, entriesFromListing, enumerateNestedArchives, finalizeDispositions,
  observeExtractedEntries, sniffMagic, toCoverageRow, type ArchiveLister, type InventoryEntry,
} from '../src/scanners/file-inventory.ts';
import { collectFiles, contentUnsupportedReason, isContentInspectable, runRealRepositoryScanners } from '../src/scanners/real-repository-scanners.ts';
import { buildRepositoryInventory, applyRepositoryEngineOutcomes, applySecurityEngineOutcomes, makeArchiveLister } from '../src/scanners/repository-inventory.ts';
import { runBounded } from '../src/workers/osv-worker.ts';

// Behavioural tests over a real extracted tree: every file the archive listing
// names ends up with an explicit disposition, and no file is ever silently
// dropped. The tree is written by the test, so the expected outcomes are
// facts about the fixture, not assumptions about the engines.

let root: string;
let repositoryRoot: string;
let listing: string[];

async function write(relative: string, content: string | Buffer) {
  const absolute = path.join(repositoryRoot, ...relative.split('/'));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spr-inventory-test-'));
  repositoryRoot = path.join(root, 'repo-abc123');
  await mkdir(repositoryRoot);
  await write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { lodash: '4.17.21' } }));
  await write('package-lock.json', JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' }, 'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' } } }));
  await write('src/index.ts', 'export const answer = 42;\n');
  await write('src/config.yaml', 'privileged: true\n');
  await write('README.md', '# fixture\n');
  await write('LICENSE', 'MIT\n');
  await write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  await write('bin/tool.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
  await write('empty.txt', '');
  await write('node_modules/left-pad/index.js', 'module.exports = () => {};\n');
  await write('.github/workflows/ci.yml', 'name: ci\n');
  await write('tests/fixture.test.ts', 'const secret = "not-a-real-secret-value-12345";\n');
  await write('big/large.js', 'a'.repeat(2 * 1024 * 1024 + 10));
  // A real nested archive (tar, so the fixture builds on every platform) and a malformed one.
  const nestedSource = path.join(root, 'nested-src');
  await mkdir(path.join(nestedSource, 'inner'), { recursive: true });
  await writeFile(path.join(nestedSource, 'inner', 'a.txt'), 'a');
  await writeFile(path.join(nestedSource, 'inner', 'b.txt'), 'b');
  const tarPath = path.join(repositoryRoot, 'vendor-bundle.tar');
  let tarResult = await runBounded(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-cf', tarPath, '-C', nestedSource, 'inner'], 30_000);
  if (tarResult.code !== 0 && process.platform === 'win32') tarResult = await runBounded('tar.exe', ['--force-local', '-cf', tarPath, '-C', nestedSource, 'inner'], 30_000);
  if (tarResult.code !== 0) throw new Error(`fixture tar failed: ${tarResult.stderr}`);
  await write('broken.zip', 'this is not a zip archive');
  // A symlink; skipped on platforms where creating one is not permitted.
  try { await symlink(path.join(repositoryRoot, 'README.md'), path.join(repositoryRoot, 'README-link.md')); } catch { /* not permitted here */ }
  // The listing an archive tool would print: every entry under the root folder.
  listing = [
    'repo-abc123/', 'repo-abc123/package.json', 'repo-abc123/package-lock.json', 'repo-abc123/src/', 'repo-abc123/src/index.ts', 'repo-abc123/src/config.yaml', 'repo-abc123/README.md', 'repo-abc123/LICENSE',
    'repo-abc123/assets/logo.png', 'repo-abc123/bin/tool.exe', 'repo-abc123/empty.txt', 'repo-abc123/node_modules/left-pad/index.js', 'repo-abc123/.github/workflows/ci.yml', 'repo-abc123/tests/fixture.test.ts', 'repo-abc123/big/large.js',
    'repo-abc123/vendor-bundle.tar', 'repo-abc123/broken.zip', 'repo-abc123/README-link.md', 'repo-abc123/missing-after-extraction.txt',
    // duplicate path occurrence, as some archives carry
    'repo-abc123/README.md',
  ];
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('file categorisation', () => {
  it('classifies by real filename characteristics and preserves unknown', () => {
    expect(categorizeFile('package.json').category).toBe('dependency_manifest');
    expect(categorizeFile('package-lock.json').category).toBe('lockfile');
    expect(categorizeFile('src/index.ts').category).toBe('source_code');
    expect(categorizeFile('sbom.cdx.json').category).toBe('sbom');
    expect(categorizeFile('.github/workflows/ci.yml').category).toBe('ci_cd');
    expect(categorizeFile('Dockerfile').category).toBe('build_deployment');
    expect(categorizeFile('infra/main.tf').category).toBe('infrastructure');
    expect(categorizeFile('LICENSE').category).toBe('license');
    expect(categorizeFile('README.md').category).toBe('documentation');
    expect(categorizeFile('tests/x.test.ts').category).toBe('test');
    expect(categorizeFile('dist/app.exe').category).toBe('binary');
    expect(categorizeFile('lib/thing.jar').category).toBe('package');
    expect(categorizeFile('bundle.tar.gz').category).toBe('archive');
    expect(categorizeFile('weird.qqq')).toEqual({ category: 'unknown', detectedType: null, detectionMethod: 'none' });
    expect(categorizeFile('noextension')).toEqual({ category: 'unknown', detectedType: null, detectionMethod: 'none' });
  });
  it('detects formats from bytes only when the bytes say so', () => {
    expect(sniffMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(sniffMagic(Buffer.from([0x1f, 0x8b, 0x08]))).toBe('gzip');
    expect(sniffMagic(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe('elf');
    expect(sniffMagic(Buffer.from('hello world'))).toBeNull();
    expect(sniffMagic(Buffer.alloc(0))).toBeNull();
  });
  it('shares one content-inspectability policy between the scanners and the inventory', () => {
    expect(isContentInspectable('src/a.ts')).toBe(true);
    expect(isContentInspectable('Dockerfile')).toBe(true);
    expect(isContentInspectable('.npmrc')).toBe(true);
    expect(isContentInspectable('logo.png')).toBe(false);
    expect(contentUnsupportedReason('logo.png')).toBe('NOT_A_CONTENT_INSPECTED_TYPE');
    expect(contentUnsupportedReason('a.yaml')).toBeNull();
  });
});

describe('zero-file-loss inventory of an extracted repository', () => {
  let inventory: Awaited<ReturnType<typeof buildRepositoryInventory>>;
  const lister: ArchiveLister = makeArchiveLister(runBounded);

  beforeAll(async () => {
    inventory = await buildRepositoryInventory({ listing, repositoryRoot, subdirectory: '', archiveLister: lister });
  });

  it('gives every listed file a row, drops directories, and preserves duplicate path occurrences', () => {
    const files = listing.filter((e) => !e.endsWith('/')).length;
    const topLevel = inventory.entries.filter((e) => e.source === 'github-archive');
    expect(topLevel.length).toBe(files);
    expect(topLevel.filter((e) => e.path === 'README.md').length).toBe(2);
    expect(new Set(topLevel.map((e) => e.sequence)).size).toBe(topLevel.length);
  });

  it('records a listed-but-missing entry as inaccessible rather than dropping it', () => {
    const missing = inventory.entries.find((e) => e.path === 'missing-after-extraction.txt')!;
    expect(missing.disposition).toBe('inaccessible');
    expect(missing.reasonCode).toBe('NOT_PRESENT_AFTER_EXTRACTION');
  });

  it('never follows a symlink and says so', () => {
    const link = inventory.entries.find((e) => e.path === 'README-link.md')!;
    expect(['inaccessible']).toContain(link.disposition);
    expect(['SYMLINK_NOT_FOLLOWED', 'NOT_PRESENT_AFTER_EXTRACTION']).toContain(link.reasonCode);
  });

  it('hashes and sizes regular files, detects an empty file, and sniffs bytes over the extension', () => {
    const index = inventory.entries.find((e) => e.path === 'src/index.ts')!;
    expect(index.size).toBe(Buffer.byteLength('export const answer = 42;\n'));
    expect(index.sha256).toMatch(/^[a-f0-9]{64}$/);
    const empty = inventory.entries.find((e) => e.path === 'empty.txt')!;
    expect(empty.size).toBe(0);
    expect(empty.detectedType).toBe('empty');
    const png = inventory.entries.find((e) => e.path === 'assets/logo.png')!;
    expect(png.detectedType).toBe('magic:png');
    expect(png.detectionMethod).toBe('magic');
    const exe = inventory.entries.find((e) => e.path === 'bin/tool.exe')!;
    expect(exe.detectedType).toBe('magic:pe');
    expect(exe.category).toBe('binary');
  });

  it('enumerates a nested archive one level deep and records its members as listing-only', () => {
    const tar = inventory.entries.find((e) => e.path === 'vendor-bundle.tar')!;
    expect(tar.isArchive).toBe(true);
    expect(tar.archiveEnumerated).toBe(true);
    expect(tar.inspectionStatus).toBe('partial');
    const members = inventory.entries.filter((e) => e.parentSequence === tar.sequence);
    expect(members.map((m) => m.path).sort()).toEqual(['vendor-bundle.tar!/inner/a.txt', 'vendor-bundle.tar!/inner/b.txt']);
    for (const member of members) {
      expect(member.source).toBe('nested-archive');
      expect(member.depth).toBe(1);
      expect(member.disposition).toBe('inventoried');
      expect(member.inspectionStatus).toBe('not_inspected');
      expect(member.reasonCode).toBe('ARCHIVE_MEMBER_NOT_EXTRACTED');
    }
  });

  it('keeps a malformed archive with the exact limitation and never claims its contents were inspected', () => {
    const broken = inventory.entries.find((e) => e.path === 'broken.zip')!;
    expect(broken.isArchive).toBe(true);
    expect(broken.archiveEnumerated).toBe(false);
    expect(broken.disposition).toBe('failed');
    expect(broken.reasonCode).toBe('ARCHIVE_UNREADABLE');
    expect(inventory.entries.some((e) => e.parentSequence === broken.sequence)).toBe(false);
  });

  it('after the repository engines run, manifests are inventoried, catalogued files are analyzed, and nothing is marked inspected', () => {
    const cycloneDx = { bomFormat: 'CycloneDX', components: [{ name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21', properties: [{ name: 'syft:location:0:path', value: '/package-lock.json' }] }] };
    applyRepositoryEngineOutcomes(inventory, { manifests: ['package.json', 'package-lock.json'], manifestEvidenceId: 'ev-manifest-1', cycloneDx, syftVersion: '1.49.0', sbomEvidenceId: 'ev-sbom-1' });
    const lock = inventory.entries.find((e) => e.path === 'package-lock.json')!;
    expect(lock.analysisStatus).toBe('analyzed');
    expect(lock.disposition).toBe('analyzed');
    expect(lock.relatedComponents).toEqual(['lodash@4.17.21']);
    expect(lock.relatedEvidenceIds).toEqual(expect.arrayContaining(['ev-manifest-1', 'ev-sbom-1']));
    expect(lock.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['repository-worker', 'syft']));
    const manifest = inventory.entries.find((e) => e.path === 'package.json')!;
    expect(manifest.disposition).toBe('inventoried');
    expect(manifest.analysisStatus).toBe('not_analyzed');
    // A source file this job did not read is NOT inspected: it stays inventoried with the reason.
    const index = inventory.entries.find((e) => e.path === 'src/index.ts')!;
    expect(index.disposition).toBe('inventoried');
    expect(index.inspectionStatus).toBe('not_inspected');
    expect(index.reasonCode).toBe('CONTENT_NOT_INSPECTED_BY_THIS_JOB');
    // A type no engine reads is unsupported, with the policy reason.
    const png = inventory.entries.find((e) => e.path === 'assets/logo.png')!;
    expect(png.disposition).toBe('unsupported');
    expect(png.reasonCode).toBe('NOT_A_CONTENT_INSPECTED_TYPE');
  });

  it('after the content engines run, read files are inspected, ignored/oversized files are skipped with reasons, and findings link to files', async () => {
    const scanned = await runRealRepositoryScanners(repositoryRoot, { bomFormat: 'CycloneDX', components: [] });
    applySecurityEngineOutcomes(inventory, { inspectionReports: scanned.inspectionReports, findings: scanned.findings.map((f, i) => ({ id: `finding-${i}`, filePath: f.filePath ?? null })), evidenceId: 'ev-security-1' });
    const index = inventory.entries.find((e) => e.path === 'src/index.ts')!;
    expect(index.disposition).toBe('inspected');
    expect(index.inspectionStatus).toBe('inspected');
    expect(index.inspectionLevel).toBe('content');
    expect(index.tools.map((t) => t.name).sort()).toEqual(['spr-iac-config-scanner-v1', 'spr-secret-scanner-v1']);
    expect(index.relatedEvidenceIds).toContain('ev-security-1');
    const vendored = inventory.entries.find((e) => e.path === 'node_modules/left-pad/index.js')!;
    expect(vendored.disposition).toBe('skipped');
    expect(vendored.reasonCode).toBe('IGNORED_DIRECTORY');
    const large = inventory.entries.find((e) => e.path === 'big/large.js')!;
    expect(large.disposition).toBe('skipped');
    expect(large.reasonCode).toBe('FILE_TOO_LARGE');
    const config = inventory.entries.find((e) => e.path === 'src/config.yaml')!;
    expect(config.relatedFindingIds.length).toBe(1);
    const configFinding = scanned.findings.find((f) => f.filePath === 'src/config.yaml');
    expect(configFinding?.title).toBe('Privileged container enabled');
    // Test fixtures are read by the secret engine (structural rules) but the
    // config engine skips them and says so; the file is still inspected.
    const fixture = inventory.entries.find((e) => e.path === 'tests/fixture.test.ts')!;
    expect(fixture.inspectionStatus).toBe('inspected');
    expect(fixture.notes.some((n) => n.reason === 'TEST_OR_CI_FILE')).toBe(true);
    // Nothing is left undecided.
    expect(inventory.entries.filter((e) => e.disposition === 'discovered').length).toBe(0);
  });

  it('computes four independent coverages with visible denominators', () => {
    const summary = computeCoverage(inventory.entries.map(toCoverageRow), { inventoryComplete: !inventory.truncated, limitations: inventory.limitations });
    expect(summary.filesDiscovered).toBe(inventory.entries.length);
    expect(summary.filesAccountedFor).toBe(inventory.entries.length);
    expect(summary.accountingCoveragePct).toBe(100);
    expect(summary.filesInspected).toBeGreaterThan(0);
    expect(summary.filesUnsupported).toBeGreaterThanOrEqual(2); // png + exe
    expect(summary.filesSkipped).toBeGreaterThanOrEqual(2); // node_modules + oversized
    expect(summary.filesFailed).toBeGreaterThanOrEqual(1); // broken.zip
    expect(summary.filesInaccessible).toBeGreaterThanOrEqual(1); // missing entry
    expect(summary.archivesDiscovered).toBe(2);
    expect(summary.archivesEnumerated).toBe(1);
    expect(summary.archivesUnreadable).toBe(1);
    expect(summary.inspectionApplicable).toBe(inventory.entries.filter((e) => e.disposition !== 'unsupported' && e.source !== 'nested-archive').length);
    expect(summary.inspectionCoveragePct).toBeLessThan(100);
    expect(summary.analysisApplicable).toBe(2); // package.json + package-lock.json
    expect(summary.filesAnalyzed).toBe(1);
    expect(summary.analysisCoveragePct).toBe(50);
    expect(summary.filesWithFindings).toBe(1);
    expect(summary.filesWithoutFindings).toBe(summary.filesDiscovered - 1);
    expect(summary.inventoryComplete).toBe(true);
    expect(summary.limitations).toEqual([]);
  });
});

describe('merge ranks and truncation', () => {
  it('a positive outcome outranks a policy outcome; a failure stays visible over unsupported', () => {
    const { entries } = entriesFromListing(['r/', 'r/a.ts', 'r/b.png'], { source: 'github-archive', stripSegments: 1 });
    applyContentInspection(entries, [{ path: 'b.png', outcome: 'unsupported', tool: { name: 't', version: '1', action: 'content' }, reasonCode: 'NOT_A_CONTENT_INSPECTED_TYPE' }]);
    applyContentInspection(entries, [{ path: 'b.png', outcome: 'failed', tool: { name: 't', version: '1', action: 'content' }, reasonCode: 'READ_FAILED' }]);
    expect(entries[1].disposition).toBe('failed');
    applyCatalogLocations(entries, { components: [{ name: 'x', version: '1', properties: [{ name: 'syft:location:0:path', value: '\\b.png' }] }] }, { name: 'syft', version: '1.49.0', action: 'catalog' });
    expect(entries[1].disposition).toBe('analyzed');
    expect(entries[1].notes.some((n) => n.reason === 'READ_FAILED')).toBe(true);
  });
  it('marks the inventory incomplete when the listing exceeds the cap, and says so in coverage', () => {
    const big = Array.from({ length: 100_050 }, (_, i) => `r/f${i}.txt`);
    const { entries, truncated } = entriesFromListing(big, { source: 'github-archive', stripSegments: 1 });
    expect(truncated).toBe(true);
    expect(entries.length).toBe(100_000);
    const summary = computeCoverage(entries.map(toCoverageRow), { inventoryComplete: false });
    expect(summary.inventoryComplete).toBe(false);
    expect(summary.limitations[0]).toMatch(/INVENTORY_TRUNCATED/);
    expect(summary.accountingCoveragePct).toBeLessThan(100);
  });
  it('a supported file no engine reported on becomes unknown, never inspected', () => {
    const { entries } = entriesFromListing(['r/', 'r/a.ts'], { source: 'github-archive', stripSegments: 1 });
    entries[0].disposition = 'inventoried';
    finalizeDispositions(entries, { contentUnsupportedReason: (e) => contentUnsupportedReason(e.path), contentInspectionRan: true });
    expect(entries[0].disposition).toBe('unknown');
    expect(entries[0].reasonCode).toBe('NO_ENGINE_REPORTED');
    expect(entries[0].inspectionStatus).toBe('not_inspected');
  });
  it('a subdirectory scan records files outside the requested scope as skipped', async () => {
    const scoped = await buildRepositoryInventory({ listing, repositoryRoot, subdirectory: 'src', archiveLister: async () => ({ ok: false, reasonCode: 'ARCHIVE_UNREADABLE' }) });
    const outside = scoped.entries.find((e) => e.path === 'README.md')!;
    expect(outside.disposition).toBe('skipped');
    expect(outside.reasonCode).toBe('OUTSIDE_SCAN_SCOPE');
    const inside = scoped.entries.find((e) => e.path === 'src/index.ts')!;
    expect(inside.disposition).toBe('inventoried');
  });
});

describe('collectFiles reports every file it does not offer', () => {
  it('names the reason for each ignored, unsupported or oversized file', async () => {
    const { files, reports } = await collectFiles(repositoryRoot);
    expect(files.some((f) => f.relativePath === 'src/index.ts')).toBe(true);
    const byPath = new Map(reports.map((r) => [r.path, r]));
    expect(byPath.get('node_modules/left-pad/index.js')).toMatchObject({ outcome: 'skipped', reasonCode: 'IGNORED_DIRECTORY' });
    expect(byPath.get('assets/logo.png')).toMatchObject({ outcome: 'unsupported', reasonCode: 'NOT_A_CONTENT_INSPECTED_TYPE' });
    expect(byPath.get('big/large.js')).toMatchObject({ outcome: 'skipped', reasonCode: 'FILE_TOO_LARGE' });
    expect(byPath.has('src/index.ts')).toBe(false);
  });
});

describe('observeExtractedEntries refuses to open a path that escapes the root', () => {
  it('records an escaping listing entry as inaccessible without touching it', async () => {
    const entry: InventoryEntry = { ...entriesFromListing(['x/../../etc/passwd'], { source: 'github-archive' }).entries[0] };
    await observeExtractedEntries(repositoryRoot, [entry]);
    expect(entry.disposition).toBe('inaccessible');
    expect(entry.reasonCode).toBe('PATH_OUTSIDE_ROOT');
    expect(entry.absolutePath).toBeNull();
  });
});

describe('nested archive enumeration honours the depth limit', () => {
  it('records but does not enumerate an archive deeper than the limit', async () => {
    const { entries } = entriesFromListing(['r/', 'r/deep.tar'], { source: 'github-archive', stripSegments: 1 });
    entries[0].depth = 1; entries[0].absolutePath = path.join(repositoryRoot, 'vendor-bundle.tar'); entries[0].isArchive = true;
    const result = await enumerateNestedArchives(entries, makeArchiveLister(runBounded), { name: 'lister', version: '1', action: 'listing' });
    expect(result.added).toBe(0);
    expect(entries[0].archiveEnumerated).toBe(false);
    expect(entries[0].reasonCode).toBe('NESTED_ARCHIVE_DEPTH_LIMIT');
  });
});

describe('uploaded archive declared-size pre-check', () => {
  it('parses unzip -l and tar -tvf listings into entry and byte totals, ignoring directories', async () => {
    const { parseDeclaredSizes } = await import('../src/workers/intake-scan-worker.ts');
    const tarListing = ['drwxr-xr-x user/group        0 2026-09-18 01:34 a/', '-rw-r--r-- user/group       3 2026-09-18 01:34 a/x.txt', '-rw-r--r-- user/group 5000000 2026-09-18 01:34 a/big.bin', ''].join('\n');
    expect(parseDeclaredSizes('tar', tarListing)).toEqual({ entries: 2, bytes: 5000003 });
    if (process.platform !== 'win32') {
      const zipListing = ['Archive:  x.zip', '  Length      Date    Time    Name', '---------  ---------- -----   ----', '        0  2026-09-18 01:34   a/', '        3  2026-09-18 01:34   a/x.txt', '---------                     -------', '        3                     2 files'].join('\n');
      expect(parseDeclaredSizes('zip', zipListing)).toEqual({ entries: 1, bytes: 3 });
    }
    expect(parseDeclaredSizes('tar', 'garbage')).toBeNull();
  });
});
