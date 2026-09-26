import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeComponentName } from '../security/component-path-normalization.ts';

export type ScannerFinding = {
  engineId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  category: string;
  title: string;
  description: string;
  component?: string;
  /** Repository-relative path of the file the finding was observed in, when it was observed in a file. */
  filePath?: string;
};

export type ContentInspectionReport =
  | { path: string; outcome: 'inspected'; tool: { name: string; version: string; action: string } }
  | { path: string; outcome: 'unsupported' | 'skipped' | 'failed'; tool: { name: string; version: string; action: string }; reasonCode: string; reasonDetail?: string };

export type FileOffer = { absolutePath: string; relativePath: string; size: number };

const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
// Every type the content engines read. Anything else is recorded as
// unsupported for content inspection -- accounted for, never read.
const TEXT_EXTENSIONS = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts','.json','.yaml','.yml','.toml','.ini','.cfg','.conf','.env','.tf','.tfvars','.hcl','.xml','.properties','.py','.go','.rs','.java','.kt','.kts','.rb','.php','.cs','.sh','.bash','.zsh','.ps1','.bat','.cmd','.sql','.md','.mdx','.txt','.html','.htm','.css','.scss','.less','.vue','.svelte','.astro','.gradle','.groovy','.scala','.swift','.m','.mm','.dart','.lua','.pl','.ex','.exs','.erl','.hs','.clj','.r','.jl','.graphql','.gql','.proto','.lock','.csv','.plist','.bicep','.pem','.crt','.cer','.key']);
const TEXT_FILENAMES = new Set(['dockerfile', 'containerfile', 'makefile', 'procfile', 'jenkinsfile', 'gemfile', 'podfile', 'justfile', 'rakefile', 'vagrantfile', 'brewfile', 'pipfile', 'cabal.project', 'license', 'licence', 'notice', 'readme', 'codeowners']);
const IGNORED = new Set(['.git','node_modules','vendor','dist','build','coverage','.cache','.venv','venv','target']);
const CONTENT_ENGINE_VERSION = '1';
const inventoryTool = { name: 'spr-content-scanner', version: CONTENT_ENGINE_VERSION, action: 'content' };

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** True when a file's name says the content engines read it. The single policy the inventory and the scanners share. */
export function isContentInspectable(relativePath: string): boolean {
  const base = path.posix.basename(relativePath.replaceAll('\\', '/')).toLowerCase();
  if (TEXT_FILENAMES.has(base) || base.startsWith('dockerfile.') || base.endsWith('.dockerfile')) return true;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return true; // dotfiles such as .npmrc, .gitignore, .env
  return TEXT_EXTENSIONS.has(path.posix.extname(base));
}

export function contentUnsupportedReason(relativePath: string): string | null {
  return isContentInspectable(relativePath) ? null : 'NOT_A_CONTENT_INSPECTED_TYPE';
}

/**
 * Enumerates the files the content engines will read and reports, per file,
 * why any file was NOT offered: ignored directory, unsupported type, over the
 * size limit, symlink. The reports are what make "not inspected" explicit in
 * the inventory instead of implicit in a filter.
 */
export async function collectFiles(root: string): Promise<{ files: FileOffer[]; reports: ContentInspectionReport[] }> {
  const files: FileOffer[] = [];
  const reports: ContentInspectionReport[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  const relative = (full: string) => path.relative(root, full).replaceAll('\\', '/');
  async function skipTree(dir: string, reasonCode: string, reasonDetail: string) {
    // Every file under a skipped directory is still reported individually so
    // the inventory can say, for each one, that it was skipped and why.
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { reports.push({ path: relative(full), outcome: 'skipped', tool: inventoryTool, reasonCode, reasonDetail }); continue; }
      if (entry.isDirectory()) await skipTree(full, reasonCode, reasonDetail);
      else if (entry.isFile()) reports.push({ path: relative(full), outcome: 'skipped', tool: inventoryTool, reasonCode, reasonDetail });
    }
  }
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // Never follow a symlink (it could leave the tree); skip it rather than
      // failing the review -- the repository worker removes them as well.
      if (entry.isSymbolicLink()) { reports.push({ path: relative(full), outcome: 'skipped', tool: inventoryTool, reasonCode: 'SYMLINK_NOT_FOLLOWED', reasonDetail: 'Symbolic links are never followed by the content engines.' }); continue; }
      if (entry.isDirectory() && IGNORED.has(entry.name)) { await skipTree(full, 'IGNORED_DIRECTORY', `Files under ${entry.name}/ (vendored, generated or build output) are not read by the content engines.`); continue; }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        // A plain counter, not files.length: incrementing an array's own
        // .length property splices in a sparse "empty" hole before the next
        // push ever runs, so every file after the first left `files` with
        // undefined entries interleaved among the real paths.
        const rel = relative(full);
        const size = (await stat(full)).size;
        fileCount += 1;
        if (fileCount > MAX_FILES) {
          reports.push({ path: rel, outcome: 'skipped', tool: inventoryTool, reasonCode: 'CONTENT_FILE_BUDGET_EXCEEDED', reasonDetail: `Only the first ${MAX_FILES} files are offered to content engines; the repository scan and SBOM continue.` });
          continue;
        }
        if (totalBytes + size > MAX_TOTAL_BYTES) {
          reports.push({ path: rel, outcome: 'skipped', tool: inventoryTool, reasonCode: 'CONTENT_BYTE_BUDGET_EXCEEDED', reasonDetail: `Content inspection is capped at ${MAX_TOTAL_BYTES} bytes; the repository scan and SBOM continue.` });
          continue;
        }
        totalBytes += size;
        if (!isContentInspectable(rel)) { reports.push({ path: rel, outcome: 'unsupported', tool: inventoryTool, reasonCode: 'NOT_A_CONTENT_INSPECTED_TYPE', reasonDetail: 'The content engines do not read this file type.' }); continue; }
        if (size > MAX_FILE_BYTES) { reports.push({ path: rel, outcome: 'skipped', tool: inventoryTool, reasonCode: 'FILE_TOO_LARGE', reasonDetail: `Files over ${MAX_FILE_BYTES} bytes are not read by the content engines.` }); continue; }
        files.push({ absolutePath: full, relativePath: rel, size });
      }
    }
  }
  await walk(root);
  return { files, reports };
}

// Test/spec sources and CI workflow files routinely embed literal strings
// that exist only to exercise a scanner's own detection logic (a fixture
// deployment.yaml written inline, a fake HMAC secret used to test signature
// verification, a local-emulator-only password). None of that is deployed
// configuration or a real leaked credential, so context-sensitive rules skip
// these paths; audited directly against this repository's own self-scan,
// which otherwise reported 3 high-severity findings that were all fixture
// data from the scanner's own test suite and CI config.
const TEST_OR_FIXTURE_DIR = /(^|\/)(?:tests?|__tests__|__mocks__|__fixtures__)\//i;
const TEST_FILE_NAME = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const CI_WORKFLOW_PATH = /^\.github\/workflows\//i;

function isTestOrCiFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return TEST_OR_FIXTURE_DIR.test(normalized) || TEST_FILE_NAME.test(normalized) || CI_WORKFLOW_PATH.test(normalized);
}

// The generic "password/secret/apiKey = <value>" rules key off property
// names that are just as commonly used for two non-secret things: an
// UPPER_SNAKE_CASE environment-variable *name* being passed around as a
// string (`apiKey: 'VITE_FIREBASE_API_KEY'`), and an explicitly-labeled
// placeholder/fallback used when real configuration is absent
// (`apiKey: 'spr-missing-firebase-config'`). Neither is a credential value,
// so a match is only kept when it could plausibly be one.
const ENV_VAR_NAME_SHAPED = /^[A-Z][A-Z0-9_]{2,}$/;
const PLACEHOLDER_VALUE = /missing|placeholder|changeme|not[-_]?(?:a[-_]?)?secret|invalid|example|dummy|fixture|xxx|your[-_]/i;

function isPlausibleSecretValue(value: string): boolean {
  return !ENV_VAR_NAME_SHAPED.test(value) && !PLACEHOLDER_VALUE.test(value);
}

type SecretRule = { pattern: RegExp; title: string; severity: 'critical' | 'high' | 'medium'; skipTestAndCiFiles?: boolean; captureValue?: boolean };

const secretRules: SecretRule[] = [
  { pattern: /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/, title: 'Private key material', severity: 'critical' },
  { pattern: /AKIA[0-9A-Z]{16}/, title: 'AWS access key identifier', severity: 'high' },
  { pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/, title: 'GitHub token-like credential', severity: 'high' },
  { pattern: /sk_live_[A-Za-z0-9]{16,}/, title: 'Stripe live secret-like credential', severity: 'critical' },
  { pattern: /AIza[0-9A-Za-z_-]{30,}/, title: 'Google API key-like credential', severity: 'high' },
  // High-signal branded patterns above are structural enough to keep scanning
  // everywhere, including test files -- a real key literally matching one of
  // those formats is still almost certainly a genuine accidental leak. This
  // generic assignment pattern is not: "secret"/"apiKey"/"password" are
  // common property and variable names, so it only carries real signal in
  // application/config source, not test fixtures or CI-only credentials.
  { pattern: /(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["']([^"']{12,})["']/i, title: 'Hard-coded credential assignment', severity: 'high', skipTestAndCiFiles: true, captureValue: true },
];

export async function scanSecrets(root: string, offered?: FileOffer[], reports?: ContentInspectionReport[]): Promise<ScannerFinding[]> {
  const findings: ScannerFinding[] = [];
  const files = offered ?? (await collectFiles(root)).files;
  const tool = { name: 'spr-secret-scanner-v1', version: CONTENT_ENGINE_VERSION, action: 'content' };
  for (const { absolutePath: file, relativePath } of files) {
    let text: string;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { reports?.push({ path: relativePath, outcome: 'failed', tool, reasonCode: 'READ_FAILED', reasonDetail: error instanceof Error ? error.message.slice(0, 200) : 'read failed' }); continue; }
    if (text.length > MAX_FILE_BYTES) { reports?.push({ path: relativePath, outcome: 'skipped', tool, reasonCode: 'FILE_TOO_LARGE' }); continue; }
    reports?.push({ path: relativePath, outcome: 'inspected', tool });
    const isTestOrCi = isTestOrCiFile(relativePath);
    for (const { pattern, title, severity, skipTestAndCiFiles, captureValue } of secretRules) {
      if (skipTestAndCiFiles && isTestOrCi) continue;
      const matched = captureValue
        ? Array.from(text.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))).some((m) => m[1] !== undefined && isPlausibleSecretValue(m[1]))
        : pattern.test(text);
      if (matched) {
        findings.push({ engineId: 'spr-secret-scanner-v1', severity, category: 'Secret', title, description: `A credential pattern was observed in ${relativePath}. The matched secret value is intentionally not persisted.`, filePath: relativePath });
      }
    }
  }
  return findings;
}

type ConfigRule = { pattern: RegExp; title: string; severity: 'critical' | 'high' | 'medium' | 'low'; captureValue?: boolean };

const configRules: ConfigRule[] = [
  { pattern: /privileged\s*:\s*true/i, title: 'Privileged container enabled', severity: 'high' },
  { pattern: /allowPrivilegeEscalation\s*:\s*true/i, title: 'Privilege escalation explicitly allowed', severity: 'high' },
  { pattern: /hostNetwork\s*:\s*true/i, title: 'Kubernetes host networking enabled', severity: 'high' },
  { pattern: /0\.0\.0\.0\/0/, title: 'World-open network range observed', severity: 'medium' },
  { pattern: /publicly_accessible\s*=\s*true/i, title: 'Public accessibility enabled in IaC', severity: 'medium' },
  { pattern: /aws_s3_bucket_public_access_block[\s\S]{0,200}block_public_(?:acls|policy)\s*=\s*false/i, title: 'S3 public access protection disabled', severity: 'high' },
  // Same false-positive shape as the secret scanner's generic rule: this
  // matches env-var *names* (`apiKey: 'VITE_FIREBASE_API_KEY'`) and labeled
  // placeholder fallbacks (`apiKey: 'spr-missing-firebase-config'`) just as
  // readily as an actual inlined key, so it needs the same value filter.
  { pattern: /api[_-]?key\s*[:=]\s*["']([^$<{][^"']*)["']/i, title: 'Static API key-like configuration', severity: 'high', captureValue: true },
];

export async function scanConfiguration(root: string, offered?: FileOffer[], reports?: ContentInspectionReport[]): Promise<ScannerFinding[]> {
  const findings: ScannerFinding[] = [];
  const files = offered ?? (await collectFiles(root)).files;
  const tool = { name: 'spr-iac-config-scanner-v1', version: CONTENT_ENGINE_VERSION, action: 'content' };
  for (const { absolutePath: file, relativePath } of files) {
    // Every configRules pattern targets deployed/deployable configuration
    // (containers, IaC, live config wiring). A test file can only ever embed
    // a fixture string exercising this same scanner -- never real
    // configuration -- so config scanning skips test/CI paths entirely
    // rather than per-rule.
    if (isTestOrCiFile(relativePath)) { reports?.push({ path: relativePath, outcome: 'skipped', tool, reasonCode: 'TEST_OR_CI_FILE', reasonDetail: 'Configuration rules do not run over test fixtures or CI workflow files.' }); continue; }
    let text: string;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { reports?.push({ path: relativePath, outcome: 'failed', tool, reasonCode: 'READ_FAILED', reasonDetail: error instanceof Error ? error.message.slice(0, 200) : 'read failed' }); continue; }
    reports?.push({ path: relativePath, outcome: 'inspected', tool });
    for (const { pattern, title, severity, captureValue } of configRules) {
      const matched = captureValue
        ? Array.from(text.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))).some((m) => m[1] !== undefined && isPlausibleSecretValue(m[1]))
        : pattern.test(text);
      if (matched) findings.push({ engineId: 'spr-iac-config-scanner-v1', severity, category: 'Configuration', title, description: `A concrete configuration pattern was observed in ${relativePath}.`, filePath: relativePath });
    }
  }
  return findings;
}

// scanRoot is optional so callers that already hold a normalized SBOM keep
// working, but it is always passed by runRealRepositoryScanners. Normalizing
// again here is idempotent and deliberate: it guarantees no absolute scan
// path can reach a finding's component/description (and therefore the
// finding identity) even if this is ever called with a raw Syft document.
// Licence coverage is a statement about the packages a repository depends on.
// Two kinds of Syft component are not packages and are not evaluated:
//
//  - type "file": on Linux, Syft 1.49 emits the repository's own manifest
//    files (package-lock.json, each .github/workflows/*.yml) as versionless
//    file components with no purl. They are the scanned software itself, not
//    a dependency, and the repository worker already drops versionless
//    entries before persisting the SBOM -- so a finding against one counted
//    a "missing licence" for a component that was not in the denominator.
//  - pkg:github/ (a GitHub Actions `uses:` reference): the workflow line is
//    the only thing that names it, and has nowhere to carry a licence.
//
// Found in a self-scan: 19 of 20 "License not observed" findings were one of
// these two shapes. Both stay in the SBOM (actions are supply-chain inputs);
// neither is evaluated, and every report states that scope.
export function isLicenceEvaluable(component: { purl?: string | null; version?: string | null; type?: string | null } | null | undefined): boolean {
  if (!component) return false;
  if (component.type === 'file') return false;
  // Mirrors the persistence rule (osv-worker keeps only versioned components)
  // so findings and denominator are drawn from the same set.
  if (typeof component.version !== 'string' || component.version.length === 0) return false;
  if (typeof component.purl === 'string' && component.purl.startsWith('pkg:github/')) return false;
  return true;
}

export const LICENCE_SCOPE_NOTE = 'Licence coverage is measured over versioned package components. GitHub Actions referenced from CI workflows (pkg:github/ components) and the repository manifest files that Syft records as file components are not evaluated for licence: a workflow reference carries no licence metadata, and a manifest file is the scanned software itself, not a dependency.';

/** The first `syft:location:N:path` a component carries, as a scan-root-relative POSIX path. */
export function componentLocation(component: any): string | null {
  const properties = Array.isArray(component?.properties) ? component.properties : [];
  for (const property of properties) {
    if (typeof property?.name === 'string' && /^syft:location:\d+:path$/.test(property.name) && typeof property.value === 'string') {
      return property.value.replaceAll('\\', '/').replace(/^\/+/, '');
    }
  }
  return null;
}

export function scanLicenses(cycloneDx: any, scanRoot?: string): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const components = Array.isArray(cycloneDx?.components) ? cycloneDx.components : [];
  for (const component of components) {
    if (!isLicenceEvaluable(component)) continue;
    const licenses = Array.isArray(component?.licenses) ? component.licenses : [];
    if (licenses.length === 0) {
      const name = normalizeComponentName(component?.name, scanRoot);
      const location = componentLocation(component);
      findings.push({ engineId: 'spr-license-scanner-v1', severity: 'medium', category: 'License', title: 'License not observed', description: `No license declaration was present in the generated SBOM for ${name}.`, component: name, ...(location ? { filePath: location } : {}) });
    }
  }
  return findings;
}

export function scannerEvidenceHash(findings: ScannerFinding[]) {
  return `sha256:${digest(JSON.stringify(findings))}`;
}

export async function runRealRepositoryScanners(root: string, cycloneDx: any) {
  const { files, reports } = await collectFiles(root);
  const secretReports: ContentInspectionReport[] = [];
  const configReports: ContentInspectionReport[] = [];
  const [secrets, configuration] = await Promise.all([scanSecrets(root, files, secretReports), scanConfiguration(root, files, configReports)]);
  const licenses = scanLicenses(cycloneDx, root);
  return {
    findings: [...secrets, ...configuration, ...licenses],
    engines: ['spr-secret-scanner-v1','spr-iac-config-scanner-v1','spr-license-scanner-v1'],
    // What each engine did with each file it was offered, plus why the rest
    // were not offered. Consumed by the file inventory; never inferred there.
    inspectionReports: [...reports, ...secretReports, ...configReports],
    filesOffered: files.length,
  };
}
