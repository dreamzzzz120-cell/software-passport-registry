/**
 * Zero-file-loss inventory for a scan.
 *
 * Every file SPR learns about during a scan gets one inventory row with an
 * explicit disposition. The discovery source is the archive listing (or the
 * intake session), not the scanners: a scanner that never opened a file has
 * no say in whether the file exists. Each engine then reports what it did with
 * each file -- read it, catalogued it, skipped it and why -- and those
 * contributions are merged, never overwritten, so a file another engine failed
 * to read still shows that failure beside the engine that succeeded.
 *
 * Nothing here infers. A file is 'inspected' only when an engine reports it
 * read the bytes; 'analyzed' only when a cataloger names the file as the
 * location it extracted components from. A file with no finding is a file
 * with no finding, not a file that was inspected.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

export type FileCategory =
  | 'dependency_manifest' | 'lockfile' | 'source_code' | 'sbom' | 'configuration' | 'ci_cd' | 'build_deployment'
  | 'binary' | 'package' | 'archive' | 'documentation' | 'license' | 'test' | 'infrastructure' | 'data' | 'unknown';

export type Disposition =
  | 'discovered' | 'inventoried' | 'classified' | 'queued' | 'inspected' | 'partially_inspected' | 'analyzed'
  | 'unsupported' | 'skipped' | 'failed' | 'inaccessible' | 'unknown';

export type InspectionStatus = 'inspected' | 'partial' | 'not_inspected' | 'failed';
export type AnalysisStatus = 'analyzed' | 'not_analyzed' | 'failed';
export type DetectionMethod = 'magic' | 'extension' | 'filename' | 'none';
export type InventorySource = 'github-archive' | 'intake-upload' | 'nested-archive';

export interface InventoryTool { name: string; version: string; action: string }
export interface InventoryNote { tool: string; outcome: string; reason?: string; detail?: string }

export interface InventoryEntry {
  sequence: number;
  path: string;
  filename: string;
  extension: string | null;
  parentSequence: number | null;
  depth: number;
  source: InventorySource;
  size: number | null;
  sha256: string | null;
  detectedType: string | null;
  detectionMethod: DetectionMethod;
  category: FileCategory;
  disposition: Disposition;
  inspectionStatus: InspectionStatus;
  analysisStatus: AnalysisStatus;
  inspectionLevel: string | null;
  tools: InventoryTool[];
  reasonCode: string | null;
  reasonDetail: string | null;
  notes: InventoryNote[];
  relatedComponents: string[];
  relatedFindingIds: string[];
  relatedEvidenceIds: string[];
  /** Absolute filesystem path when the entry exists on disk; null for listing-only entries. */
  absolutePath: string | null;
  isArchive: boolean;
  /** null = not an archive; true/false = enumeration succeeded/failed. */
  archiveEnumerated: boolean | null;
}

// Ranks used when two engines report different outcomes for one file. A
// positive outcome (the file was read or catalogued) outranks a policy outcome
// (unsupported, skipped); a failure outranks a policy outcome so it stays
// visible; 'inventoried' (observed on disk, contents not read) sits just above
// 'discovered' so any engine's verdict about the file replaces it; 'discovered'
// is the floor and means "nothing has said anything".
export const DISPOSITION_RANK: Record<Disposition, number> = {
  discovered: 0, inventoried: 1, unknown: 2, skipped: 3, unsupported: 4, inaccessible: 5, failed: 6, queued: 7, classified: 8,
  partially_inspected: 9, inspected: 10, analyzed: 11,
};
export const INSPECTION_RANK: Record<InspectionStatus, number> = { not_inspected: 0, failed: 1, partial: 2, inspected: 3 };
export const ANALYSIS_RANK: Record<AnalysisStatus, number> = { not_analyzed: 0, failed: 1, analyzed: 2 };

export const MAX_INVENTORY_ENTRIES = 100_000;
export const MAX_NESTED_ARCHIVE_CHILDREN = 20_000;
export const MAX_HASHED_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_NESTED_ARCHIVE_DEPTH = 1;
export const MAX_STEGANOGRAPHY_PROBE_BYTES = 10 * 1024 * 1024;

const MANIFEST_NAMES = new Set(['package.json', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'pipfile', 'setup.py', 'setup.cfg', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'packages.config', 'go.mod', 'cargo.toml', 'gemfile', 'composer.json', 'mix.exs', 'pubspec.yaml', 'project.clj', 'build.sbt', 'conanfile.txt', 'conanfile.py', 'environment.yml', 'podfile', 'package.swift', 'cabal.project', 'stack.yaml', 'deno.json', 'bower.json']);
const LOCKFILE_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'poetry.lock', 'pipfile.lock', 'pdm.lock', 'uv.lock', 'gradle.lockfile', 'packages.lock.json', 'go.sum', 'cargo.lock', 'gemfile.lock', 'composer.lock', 'mix.lock', 'pubspec.lock', 'podfile.lock', 'package.resolved', 'deno.lock', 'flake.lock']);
const CI_DIRS = ['.github/workflows/', '.gitlab/', '.circleci/', '.buildkite/', '.drone/'];
const CI_FILES = new Set(['.gitlab-ci.yml', '.travis.yml', 'jenkinsfile', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', '.drone.yml', 'appveyor.yml', 'cloudbuild.yaml', 'codemagic.yaml']);
const BUILD_DEPLOY_FILES = new Set(['dockerfile', 'containerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'makefile', 'cmakelists.txt', 'procfile', 'vercel.json', 'netlify.toml', 'railway.toml', 'railway.json', 'fly.toml', 'app.yaml', 'serverless.yml', 'skaffold.yaml', 'build.xml', 'webpack.config.js', 'vite.config.ts', 'vite.config.js', 'rollup.config.js', 'esbuild.config.js', 'tsconfig.json', 'babel.config.js', '.babelrc', 'gulpfile.js', 'gruntfile.js', 'justfile', 'taskfile.yml', 'wrangler.toml']);
const LICENSE_FILES = /^(license|licence|copying|notice|copyright|patents|third[-_]party[-_]notices?)(\.[a-z0-9]+)?$/i;
const DOC_FILES = /^(readme|changelog|changes|history|contributing|code_of_conduct|security|authors|maintainers|codeowners|support)(\.[a-z0-9]+)?$/i;
const SOURCE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'pyi', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'rb', 'php', 'cs', 'fs', 'vb', 'cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hh', 'm', 'mm', 'swift', 'dart', 'lua', 'pl', 'pm', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'clj', 'cljs', 'elm', 'ml', 'mli', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'sql', 'vue', 'svelte', 'astro', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'graphql', 'gql', 'proto', 'wasm', 'groovy', 'gradle', 'nim', 'zig', 'v', 'sol', 'asm', 's']);
const CONFIG_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'env', 'properties', 'plist', 'xml', 'editorconfig', 'npmrc', 'yarnrc', 'nvmrc', 'prettierrc', 'eslintrc', 'babelrc', 'browserslistrc', 'gitattributes', 'gitignore', 'dockerignore', 'lock']);
const INFRA_EXTENSIONS = new Set(['tf', 'tfvars', 'hcl', 'bicep', 'cf', 'pp', 'nomad']);
const DOC_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'rst', 'txt', 'adoc', 'asciidoc', 'pdf', 'doc', 'docx', 'rtf', 'odt', 'tex']);
const BINARY_EXTENSIONS = new Set(['exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'class', 'pyc', 'pyo', 'wasm', 'elf', 'ko', 'sys', 'obj', 'pdb', 'node']);
const PACKAGE_EXTENSIONS = new Set(['jar', 'war', 'ear', 'whl', 'egg', 'gem', 'nupkg', 'deb', 'rpm', 'apk', 'ipa', 'aar', 'crate', 'tgz-pkg', 'vsix', 'msi', 'pkg', 'snap', 'appimage', 'dmg']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', '7z', 'rar', 'zst']);
const DATA_EXTENSIONS = new Set(['csv', 'tsv', 'parquet', 'avro', 'db', 'sqlite', 'sqlite3', 'ndjson', 'jsonl', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'map', 'snap', 'pem', 'crt', 'cer', 'key', 'p12', 'pfx']);
const SBOM_NAME = /(sbom|cyclonedx|spdx|\bbom\b)/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|__fixtures__|spec|specs|e2e|cypress|__snapshots__)\//i;
const TEST_FILE = /\.(test|spec|e2e)\.[a-z]+$|_test\.(go|py|rb|rs|ex|exs)$|^test_.*\.py$/i;

export function toPosix(value: string): string { return value.replaceAll('\\', '/'); }

export function extensionOf(filename: string): string | null {
  const base = filename.toLowerCase();
  if (base === 'bun.lockb') return 'lockb';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1);
  return /^[a-z0-9_+-]{1,16}$/.test(ext) ? ext : null;
}

export function categorizeFile(relativePath: string): { category: FileCategory; detectedType: string | null; detectionMethod: DetectionMethod } {
  const posix = toPosix(relativePath).replace(/^\/+/, '');
  const filename = posix.split('/').pop() || posix;
  const lower = filename.toLowerCase();
  const ext = extensionOf(filename);
  const byName = (category: FileCategory, type: string) => ({ category, detectedType: type, detectionMethod: 'filename' as DetectionMethod });
  const byExt = (category: FileCategory, type: string) => ({ category, detectedType: type, detectionMethod: 'extension' as DetectionMethod });

  if (LOCKFILE_NAMES.has(lower)) return byName('lockfile', `lockfile:${lower}`);
  if (MANIFEST_NAMES.has(lower) || (ext === 'csproj' || ext === 'fsproj' || ext === 'vbproj' || ext === 'gemspec' || ext === 'nuspec' || ext === 'podspec')) return byName('dependency_manifest', `manifest:${lower}`);
  if ((ext === 'json' || ext === 'xml' || ext === 'spdx') && SBOM_NAME.test(lower)) return byName('sbom', `sbom:${ext}`);
  if (ext === 'spdx' || lower.endsWith('.cdx.json') || lower.endsWith('.spdx.json') || lower.endsWith('.cdx.xml') || lower.endsWith('.spdx.xml')) return byName('sbom', `sbom:${ext}`);
  if (LICENSE_FILES.test(filename)) return byName('license', 'license-text');
  if (CI_DIRS.some((dir) => posix.toLowerCase().startsWith(dir) || posix.toLowerCase().includes(`/${dir}`)) || CI_FILES.has(lower)) return byName('ci_cd', `ci:${ext || lower}`);
  if (INFRA_EXTENSIONS.has(ext || '') || /(^|\/)(terraform|k8s|kubernetes|helm|charts?|ansible|pulumi|cloudformation)\//i.test(posix)) return byExt('infrastructure', `infrastructure:${ext || lower}`);
  if (BUILD_DEPLOY_FILES.has(lower) || lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) return byName('build_deployment', `build:${lower}`);
  if (TEST_PATH.test(posix) || TEST_FILE.test(filename)) return byName('test', `test:${ext || lower}`);
  if (DOC_FILES.test(filename) || DOC_EXTENSIONS.has(ext || '')) return byExt('documentation', `document:${ext || lower}`);
  if (ARCHIVE_EXTENSIONS.has(ext || '') || lower.endsWith('.tar.gz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz')) return byExt('archive', `archive:${ext}`);
  if (PACKAGE_EXTENSIONS.has(ext || '')) return byExt('package', `package:${ext}`);
  if (BINARY_EXTENSIONS.has(ext || '')) return byExt('binary', `binary:${ext}`);
  if (SOURCE_EXTENSIONS.has(ext || '')) return byExt('source_code', `source:${ext}`);
  if (CONFIG_EXTENSIONS.has(ext || '') || lower.startsWith('.') ) return byExt('configuration', `config:${ext || lower}`);
  if (DATA_EXTENSIONS.has(ext || '')) return byExt('data', `data:${ext}`);
  return { category: 'unknown', detectedType: null, detectionMethod: 'none' };
}

/** Byte-signature detection for the formats SPR can recognise. Returns null when the bytes match nothing known. */
export function sniffMagic(head: Buffer): string | null {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) return 'zip';
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'elf';
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return 'pe';
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (head.length >= 3 && head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68) return 'bzip2';
  if (head.length >= 6 && head[0] === 0xfd && head.subarray(1, 6).toString('latin1') === '7zXZ\0') return 'xz';
  if (head.length >= 6 && head.subarray(0, 6).toString('latin1') === '7z\xbc\xaf\x27\x1c') return '7z';
  if (head.length >= 4 && head[0] === 0xca && head[1] === 0xfe && head[2] === 0xba && head[3] === 0xbe) return 'java-class';
  if (head.length >= 4 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d) return 'wasm';
  if (head.length >= 8 && head.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n') return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  return null;
}

const MAGIC_CATEGORY: Record<string, FileCategory> = { zip: 'archive', gzip: 'archive', bzip2: 'archive', xz: 'archive', '7z': 'archive', elf: 'binary', pe: 'binary', 'java-class': 'binary', wasm: 'binary', pdf: 'documentation', png: 'data', jpeg: 'data' };

export function isArchiveEntry(entry: Pick<InventoryEntry, 'category' | 'detectedType' | 'filename'>): boolean {
  if (entry.category === 'archive') return true;
  const lower = entry.filename.toLowerCase();
  return /\.(zip|tar|tgz|tar\.gz|tar\.bz2|tar\.xz|jar|war|ear|whl|nupkg|vsix)$/.test(lower);
}

export interface DiscoveryOptions {
  source: InventorySource;
  /** Number of leading path segments to drop (1 for a GitHub codeload zip whose entries all sit under "<repo>-<sha>/"). */
  stripSegments?: number;
  startSequence?: number;
}

/**
 * Turns an archive listing into inventory entries. Directory entries (trailing
 * slash) are not files and are dropped. Every other entry -- including
 * duplicates of the same path -- becomes one row.
 */
export function entriesFromListing(listing: string[], options: DiscoveryOptions): { entries: InventoryEntry[]; truncated: boolean } {
  const entries: InventoryEntry[] = [];
  let sequence = options.startSequence ?? 0;
  let truncated = false;
  for (const raw of listing) {
    const posix = toPosix(raw).replace(/^\/+/, '');
    if (!posix || posix.endsWith('/')) continue;
    const segments = posix.split('/');
    const relative = options.stripSegments ? segments.slice(options.stripSegments).join('/') : posix;
    if (!relative) continue;
    if (entries.length >= MAX_INVENTORY_ENTRIES) { truncated = true; break; }
    entries.push(newEntry(sequence++, relative, options.source, null, 0));
  }
  return { entries, truncated };
}

export function newEntry(sequence: number, relativePath: string, source: InventorySource, parentSequence: number | null, depth: number): InventoryEntry {
  const filename = relativePath.split('/').pop() || relativePath;
  const classified = categorizeFile(relativePath);
  const entry: InventoryEntry = {
    sequence, path: relativePath, filename, extension: extensionOf(filename), parentSequence, depth, source,
    size: null, sha256: null, detectedType: classified.detectedType, detectionMethod: classified.detectionMethod, category: classified.category,
    disposition: 'discovered', inspectionStatus: 'not_inspected', analysisStatus: 'not_analyzed', inspectionLevel: null,
    tools: [], reasonCode: null, reasonDetail: null, notes: [], relatedComponents: [], relatedFindingIds: [], relatedEvidenceIds: [],
    absolutePath: null, isArchive: false, archiveEnumerated: null,
  };
  entry.isArchive = isArchiveEntry(entry);
  return entry;
}

async function hashFile(absolutePath: string): Promise<{ sha256: string; head: Buffer }> {
  const hash = createHash('sha256');
  const headChunks: Buffer[] = [];
  let headBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      if (headBytes < 16) { headChunks.push(buffer.subarray(0, 16 - headBytes)); headBytes += Math.min(16 - headBytes, buffer.length); }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return { sha256: hash.digest('hex'), head: Buffer.concat(headChunks) };
}

/**
 * Observes every listed entry on disk after extraction: size, symlink status,
 * a SHA-256 of the bytes (up to MAX_HASHED_FILE_BYTES) and a byte-signature
 * check. An entry that is missing on disk, or is a symlink, is recorded as
 * inaccessible with the reason -- it is not dropped.
 */
export async function observeExtractedEntries(root: string, entries: InventoryEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.source === 'nested-archive') continue;
    const absolute = path.resolve(root, ...entry.path.split('/'));
    const rootResolved = path.resolve(root);
    if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
      setOutcome(entry, { disposition: 'inaccessible', reasonCode: 'PATH_OUTSIDE_ROOT', reasonDetail: 'The listed path resolves outside the extracted tree and was not opened.' });
      continue;
    }
    entry.absolutePath = absolute;
    let stats;
    try { stats = await lstat(absolute); }
    catch { setOutcome(entry, { disposition: 'inaccessible', reasonCode: 'NOT_PRESENT_AFTER_EXTRACTION', reasonDetail: 'The archive listed this entry but it was not present after extraction.' }); continue; }
    if (stats.isSymbolicLink()) { setOutcome(entry, { disposition: 'inaccessible', reasonCode: 'SYMLINK_NOT_FOLLOWED', reasonDetail: 'Symbolic links are never followed; the link target was not read.' }); entry.absolutePath = null; continue; }
    if (!stats.isFile()) { setOutcome(entry, { disposition: 'inaccessible', reasonCode: 'NOT_A_REGULAR_FILE', reasonDetail: 'The entry is not a regular file.' }); entry.absolutePath = null; continue; }
    entry.size = stats.size;
    if (stats.size > MAX_HASHED_FILE_BYTES) {
      entry.notes.push({ tool: 'spr-file-inventory', outcome: 'not_hashed', reason: 'FILE_TOO_LARGE_TO_HASH', detail: `Files over ${MAX_HASHED_FILE_BYTES} bytes are not hashed.` });
    } else {
      try {
        const { sha256, head } = await hashFile(absolute);
        entry.sha256 = sha256;
        const magic = sniffMagic(head);
        if (magic) {
          entry.detectedType = `magic:${magic}`;
          if (magic === 'png' && stats.size <= MAX_STEGANOGRAPHY_PROBE_BYTES) {
            try {
              const probe = probePixelSafePng(await readFile(absolute));
              entry.notes.push({
                tool: 'spr-steganography-probe',
                outcome: probe.status,
                reason: probe.method,
                detail: probe.detail,
              });
              if (probe.status === 'detected') {
                entry.detectedType = 'magic:png+steganography:PixelSafe';
                entry.category = 'data';
              }
            } catch (error) {
              entry.notes.push({ tool: 'spr-steganography-probe', outcome: 'unknown', reason: 'PROBE_FAILED', detail: error instanceof Error ? error.message.slice(0, 200) : 'probe failed' });
            }
          }
          entry.detectionMethod = 'magic';
          if (entry.category === 'unknown' || entry.category === 'data') entry.category = MAGIC_CATEGORY[magic] ?? entry.category;
          if (MAGIC_CATEGORY[magic] === 'archive') entry.isArchive = true;
        } else if (stats.size === 0) {
          entry.detectedType = 'empty';
          entry.detectionMethod = 'magic';
        }
      } catch (error) {
        setOutcome(entry, { disposition: 'failed', reasonCode: 'READ_FAILED', reasonDetail: error instanceof Error ? error.message.slice(0, 200) : 'read failed' });
        continue;
      }
    }
    if (entry.disposition === 'discovered') { entry.disposition = 'inventoried'; }
  }
}

export function setOutcome(entry: InventoryEntry, outcome: { disposition: Disposition; reasonCode?: string; reasonDetail?: string; inspectionStatus?: InspectionStatus; analysisStatus?: AnalysisStatus; inspectionLevel?: string; tool?: InventoryTool }) {
  if (DISPOSITION_RANK[outcome.disposition] >= DISPOSITION_RANK[entry.disposition]) {
    entry.disposition = outcome.disposition;
    if (outcome.reasonCode !== undefined) entry.reasonCode = outcome.reasonCode;
    if (outcome.reasonDetail !== undefined) entry.reasonDetail = outcome.reasonDetail;
  }
  if (outcome.inspectionStatus && INSPECTION_RANK[outcome.inspectionStatus] > INSPECTION_RANK[entry.inspectionStatus]) entry.inspectionStatus = outcome.inspectionStatus;
  if (outcome.analysisStatus && ANALYSIS_RANK[outcome.analysisStatus] > ANALYSIS_RANK[entry.analysisStatus]) entry.analysisStatus = outcome.analysisStatus;
  if (outcome.inspectionLevel) entry.inspectionLevel = entry.inspectionLevel && entry.inspectionLevel !== outcome.inspectionLevel ? `${entry.inspectionLevel}+${outcome.inspectionLevel}` : outcome.inspectionLevel;
  if (outcome.tool && !entry.tools.some((t) => t.name === outcome.tool!.name && t.action === outcome.tool!.action)) entry.tools.push(outcome.tool);
  if (outcome.tool || outcome.reasonCode) entry.notes.push({ tool: outcome.tool?.name ?? 'spr-file-inventory', outcome: outcome.disposition, ...(outcome.reasonCode ? { reason: outcome.reasonCode } : {}), ...(outcome.reasonDetail ? { detail: outcome.reasonDetail } : {}) });
}

/** What a content scanner reports for each file it was offered. */
export type ContentInspectionReport =
  | { path: string; outcome: 'inspected'; tool: InventoryTool }
  | { path: string; outcome: 'unsupported' | 'skipped' | 'failed'; tool: InventoryTool; reasonCode: string; reasonDetail?: string };

export function applyContentInspection(entries: InventoryEntry[], reports: ContentInspectionReport[]): void {
  const byPath = indexByPath(entries);
  for (const report of reports) {
    const matches = byPath.get(report.path);
    if (!matches) continue;
    for (const entry of matches) {
      if (report.outcome === 'inspected') setOutcome(entry, { disposition: 'inspected', inspectionStatus: 'inspected', inspectionLevel: 'content', tool: report.tool });
      else if (report.outcome === 'failed') setOutcome(entry, { disposition: 'failed', inspectionStatus: 'failed', reasonCode: report.reasonCode, reasonDetail: report.reasonDetail, tool: report.tool });
      else setOutcome(entry, { disposition: report.outcome, reasonCode: report.reasonCode, reasonDetail: report.reasonDetail, tool: report.tool });
    }
  }
}

/**
 * Marks the files a CycloneDX cataloger names as component locations as
 * analyzed. Syft records `syft:location:N:path` per component, relative to the
 * scan root; that is the only evidence that a file was catalogued, so nothing
 * else is marked.
 */
export function applyCatalogLocations(entries: InventoryEntry[], cycloneDx: any, tool: InventoryTool, pathPrefix = ''): number {
  const byPath = indexByPath(entries);
  let touched = 0;
  const components = Array.isArray(cycloneDx?.components) ? cycloneDx.components : [];
  for (const component of components) {
    const name = typeof component?.name === 'string' ? component.name : null;
    const version = typeof component?.version === 'string' ? component.version : '';
    if (!name) continue;
    const properties = Array.isArray(component?.properties) ? component.properties : [];
    for (const property of properties) {
      if (typeof property?.name !== 'string' || !/^syft:location:\d+:path$/.test(property.name) || typeof property.value !== 'string') continue;
      const location = toPosix(property.value).replace(/^\/+/, '');
      const key = pathPrefix ? `${pathPrefix.replace(/\/+$/, '')}/${location}` : location;
      const matches = byPath.get(key);
      if (!matches) continue;
      for (const entry of matches) {
        setOutcome(entry, { disposition: 'analyzed', analysisStatus: 'analyzed', inspectionStatus: 'inspected', inspectionLevel: 'catalog', tool });
        const label = version ? `${name}@${version}` : name;
        if (!entry.relatedComponents.includes(label) && entry.relatedComponents.length < 5000) entry.relatedComponents.push(label);
        touched++;
      }
    }
  }
  return touched;
}

export function applyManifestInventory(entries: InventoryEntry[], manifestPaths: string[], evidenceId: string | null, tool: InventoryTool): void {
  const byPath = indexByPath(entries);
  for (const manifest of manifestPaths) {
    for (const entry of byPath.get(toPosix(manifest).replace(/^\/+/, '')) ?? []) {
      setOutcome(entry, { disposition: 'inventoried', tool });
      if (evidenceId && !entry.relatedEvidenceIds.includes(evidenceId)) entry.relatedEvidenceIds.push(evidenceId);
    }
  }
}

export function applyFindings(entries: InventoryEntry[], findings: Array<{ id: string; filePath: string | null | undefined }>): void {
  const byPath = indexByPath(entries);
  for (const finding of findings) {
    if (!finding.filePath) continue;
    for (const entry of byPath.get(toPosix(finding.filePath).replace(/^\/+/, '')) ?? []) {
      if (!entry.relatedFindingIds.includes(finding.id)) entry.relatedFindingIds.push(finding.id);
    }
  }
}

export function applyEvidence(entries: InventoryEntry[], evidenceId: string, predicate: (entry: InventoryEntry) => boolean): void {
  for (const entry of entries) if (predicate(entry) && !entry.relatedEvidenceIds.includes(evidenceId)) entry.relatedEvidenceIds.push(evidenceId);
}

export function markOutsideScope(entries: InventoryEntry[], subdirectory: string, tool: InventoryTool): void {
  const prefix = toPosix(subdirectory).replace(/^\/+|\/+$/g, '');
  if (!prefix) return;
  for (const entry of entries) {
    if (entry.path === prefix || entry.path.startsWith(`${prefix}/`)) continue;
    setOutcome(entry, { disposition: 'skipped', reasonCode: 'OUTSIDE_SCAN_SCOPE', reasonDetail: `The scan was requested for "${prefix}/"; files outside it were listed but not opened.`, tool });
  }
}

export function indexByPath(entries: InventoryEntry[]): Map<string, InventoryEntry[]> {
  const map = new Map<string, InventoryEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.path);
    if (list) list.push(entry); else map.set(entry.path, [entry]);
  }
  return map;
}

export type ArchiveLister = (absolutePath: string, filename: string) => Promise<{ ok: true; entries: string[] } | { ok: false; reasonCode: string; reasonDetail?: string }>;

/**
 * Enumerates archives found inside the tree, one level deep. Each child gets a
 * listing-only inventory row that points at its parent; the children are NOT
 * extracted or inspected and are recorded as such. An archive that cannot be
 * listed is kept with the exact limitation. Archives inside archives are
 * recorded but not enumerated (depth limit) -- never claimed as inspected.
 */
export async function enumerateNestedArchives(entries: InventoryEntry[], list: ArchiveLister, tool: InventoryTool, options: { maxDepth?: number } = {}): Promise<{ added: number; truncated: boolean }> {
  const maxDepth = options.maxDepth ?? MAX_NESTED_ARCHIVE_DEPTH;
  let sequence = entries.reduce((max, entry) => Math.max(max, entry.sequence), -1) + 1;
  let added = 0;
  let truncated = false;
  const candidates = entries.filter((entry) => entry.isArchive && entry.absolutePath && entry.archiveEnumerated === null && entry.disposition !== 'inaccessible' && entry.disposition !== 'failed');
  for (const archive of candidates) {
    if (archive.depth >= maxDepth) {
      archive.archiveEnumerated = false;
      setOutcome(archive, { disposition: 'inventoried', reasonCode: 'NESTED_ARCHIVE_DEPTH_LIMIT', reasonDetail: `Archives nested more than ${maxDepth} level(s) deep are recorded but not enumerated.`, inspectionLevel: 'listing', tool });
      continue;
    }
    if ((archive.size ?? 0) > MAX_HASHED_FILE_BYTES) {
      archive.archiveEnumerated = false;
      setOutcome(archive, { disposition: 'skipped', reasonCode: 'ARCHIVE_TOO_LARGE', reasonDetail: 'The archive exceeds the enumeration size limit; its contents were not listed.', tool });
      continue;
    }
    const result = await list(archive.absolutePath!, archive.filename);
    if (!result.ok) {
      archive.archiveEnumerated = false;
      setOutcome(archive, { disposition: 'failed', reasonCode: result.reasonCode, reasonDetail: result.reasonDetail ?? 'The archive could not be opened; its contents are unknown.', tool });
      continue;
    }
    archive.archiveEnumerated = true;
    setOutcome(archive, { disposition: 'inspected', inspectionStatus: 'partial', inspectionLevel: 'listing', tool, reasonCode: 'ARCHIVE_LISTED_NOT_EXTRACTED', reasonDetail: 'The archive listing was read; its member files were recorded but not extracted or inspected.' });
    let childCount = 0;
    for (const raw of result.entries) {
      const posix = toPosix(raw).replace(/^\/+/, '');
      if (!posix || posix.endsWith('/')) continue;
      if (childCount >= MAX_NESTED_ARCHIVE_CHILDREN || entries.length + 1 > MAX_INVENTORY_ENTRIES) { truncated = true; break; }
      const child = newEntry(sequence++, `${archive.path}!/${posix}`, 'nested-archive', archive.sequence, archive.depth + 1);
      setOutcome(child, { disposition: 'inventoried', inspectionLevel: 'listing', reasonCode: 'ARCHIVE_MEMBER_NOT_EXTRACTED', reasonDetail: 'Listed inside a nested archive; the member was not extracted, hashed or inspected.', tool });
      entries.push(child);
      childCount++;
      added++;
    }
    if (truncated) archive.notes.push({ tool: tool.name, outcome: 'truncated', reason: 'ARCHIVE_MEMBER_LIMIT', detail: `Only the first ${MAX_NESTED_ARCHIVE_CHILDREN} members were recorded.` });
  }
  return { added, truncated };
}

/**
 * Gives every entry that is still 'discovered' or 'inventoried' its final,
 * explicit disposition. A type no engine reads becomes 'unsupported' with the
 * policy reason. A supported file that a content engine ran over but never
 * reported on becomes 'unknown' -- a valid, visible result, never silently
 * 'inspected'. When no content engine ran in this job, an observed file stays
 * 'inventoried' (size and hash recorded, contents not read) so a later job can
 * merge its own outcome in.
 */
export function finalizeDispositions(entries: InventoryEntry[], policy: { contentUnsupportedReason: (entry: InventoryEntry) => string | null; contentInspectionRan: boolean }): void {
  for (const entry of entries) {
    if (entry.disposition === 'inspected' && entry.inspectionStatus === 'partial') { entry.disposition = 'partially_inspected'; continue; }
    if (entry.disposition !== 'discovered' && entry.disposition !== 'inventoried') continue;
    if (entry.source === 'nested-archive') continue; // stays 'inventoried' with ARCHIVE_MEMBER_NOT_EXTRACTED
    if (entry.isArchive && entry.archiveEnumerated !== null) continue;
    const reason = policy.contentUnsupportedReason(entry);
    if (reason) {
      entry.disposition = 'unsupported';
      entry.reasonCode = reason;
      entry.reasonDetail = 'No SPR engine inspects this file type; the file is accounted for but its contents were not read.';
      continue;
    }
    if (entry.disposition === 'discovered') {
      entry.disposition = 'unknown';
      entry.reasonCode = 'NOT_OBSERVED';
      entry.reasonDetail = 'The file was listed but never observed on disk.';
      continue;
    }
    if (policy.contentInspectionRan) {
      entry.disposition = 'unknown';
      entry.reasonCode = 'NO_ENGINE_REPORTED';
      entry.reasonDetail = 'A content engine ran but reported no outcome for this file.';
    } else {
      entry.reasonCode = entry.reasonCode ?? 'CONTENT_NOT_INSPECTED_BY_THIS_JOB';
      entry.reasonDetail = entry.reasonDetail ?? 'Size and hash were recorded; this job does not read file contents.';
    }
  }
}

export interface CoverageRow {
  disposition: Disposition;
  inspectionStatus: InspectionStatus;
  analysisStatus: AnalysisStatus;
  category: FileCategory;
  source: InventorySource;
  isArchive: boolean;
  archiveEnumerated: boolean | null;
  hasFindings: boolean;
  hasEvidence: boolean;
}

export interface CoverageSummary {
  filesDiscovered: number; filesAccountedFor: number; filesInspected: number; filesPartiallyInspected: number; filesAnalyzed: number;
  filesUnsupported: number; filesSkipped: number; filesFailed: number; filesInaccessible: number; filesUnknown: number;
  filesWithFindings: number; filesWithoutFindings: number; filesWithEvidence: number;
  archivesDiscovered: number; archivesEnumerated: number; archivesUnreadable: number;
  inspectionApplicable: number; analysisApplicable: number;
  accountingCoveragePct: number | null; inspectionCoveragePct: number | null; analysisCoveragePct: number | null; evidenceCoveragePct: number | null;
  inventoryComplete: boolean; limitations: string[];
}

const ANALYSIS_CATEGORIES = new Set<FileCategory>(['dependency_manifest', 'lockfile', 'package', 'sbom']);

function pct(numerator: number, denominator: number): number | null { return denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 100; }

/**
 * Four independent coverages. ACCOUNTING: every discovered file has an
 * explicit disposition. INSPECTION: of the files an engine could have read
 * (everything except types no engine supports and listing-only archive
 * members), how many were actually read in full. ANALYSIS: of the files a
 * cataloger could have parsed (manifests, lockfiles, packages, SBOMs, plus
 * anything a cataloger did parse), how many it did. EVIDENCE: of all
 * discovered files, how many are referenced by a persisted finding or
 * evidence record.
 */
export function computeCoverage(rows: CoverageRow[], options: { inventoryComplete: boolean; limitations?: string[] }): CoverageSummary {
  const count = (predicate: (row: CoverageRow) => boolean) => rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
  const filesDiscovered = rows.length;
  const filesAccountedFor = count((r) => r.disposition !== 'discovered');
  const filesInspected = count((r) => r.inspectionStatus === 'inspected');
  const filesPartiallyInspected = count((r) => r.inspectionStatus === 'partial');
  const filesAnalyzed = count((r) => r.analysisStatus === 'analyzed');
  const filesUnsupported = count((r) => r.disposition === 'unsupported');
  const filesSkipped = count((r) => r.disposition === 'skipped');
  const filesFailed = count((r) => r.disposition === 'failed');
  const filesInaccessible = count((r) => r.disposition === 'inaccessible');
  const filesUnknown = count((r) => r.disposition === 'unknown' || r.disposition === 'discovered');
  const filesWithFindings = count((r) => r.hasFindings);
  const filesWithEvidence = count((r) => r.hasEvidence || r.hasFindings);
  const archivesDiscovered = count((r) => r.isArchive);
  const archivesEnumerated = count((r) => r.isArchive && r.archiveEnumerated === true);
  const archivesUnreadable = count((r) => r.isArchive && r.archiveEnumerated === false);
  const inspectionApplicable = count((r) => r.disposition !== 'unsupported' && r.source !== 'nested-archive');
  const analysisApplicable = count((r) => ANALYSIS_CATEGORIES.has(r.category) || r.analysisStatus === 'analyzed');
  const limitations = [...(options.limitations ?? [])];
  if (!options.inventoryComplete) limitations.push('INVENTORY_TRUNCATED: the discovery source had more entries than SPR records per scan; files_discovered is a lower bound.');
  return {
    filesDiscovered, filesAccountedFor, filesInspected, filesPartiallyInspected, filesAnalyzed, filesUnsupported, filesSkipped, filesFailed, filesInaccessible, filesUnknown,
    filesWithFindings, filesWithoutFindings: filesDiscovered - filesWithFindings, filesWithEvidence,
    archivesDiscovered, archivesEnumerated, archivesUnreadable, inspectionApplicable, analysisApplicable,
    accountingCoveragePct: options.inventoryComplete ? pct(filesAccountedFor, filesDiscovered) : (filesDiscovered === 0 ? null : Math.min(pct(filesAccountedFor, filesDiscovered) ?? 0, 99.99)),
    inspectionCoveragePct: pct(filesInspected, inspectionApplicable),
    analysisCoveragePct: pct(filesAnalyzed, analysisApplicable),
    evidenceCoveragePct: pct(filesWithEvidence, filesDiscovered),
    inventoryComplete: options.inventoryComplete, limitations,
  };
}

export function toCoverageRow(entry: InventoryEntry): CoverageRow {
  return { disposition: entry.disposition, inspectionStatus: entry.inspectionStatus, analysisStatus: entry.analysisStatus, category: entry.category, source: entry.source, isArchive: entry.isArchive, archiveEnumerated: entry.archiveEnumerated, hasFindings: entry.relatedFindingIds.length > 0, hasEvidence: entry.relatedEvidenceIds.length > 0 };
}

/** Reads the first bytes of a file for magic detection without hashing it. */
export async function readHead(absolutePath: string, bytes = 16): Promise<Buffer> {
  const handle = await open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
