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
};

const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.yaml','.yml','.toml','.ini','.cfg','.conf','.env','.tf','.tfvars','.xml','.properties','.py','.go','.rs','.java','.kt','.rb','.php','.cs','.sh','.sql','.md']);
const IGNORED = new Set(['.git','node_modules','vendor','dist','build','coverage','.cache','.venv','venv','target']);

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function collectFiles(root: string) {
  const files: string[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      // Never follow a symlink (it could leave the tree); skip it rather than
      // failing the review -- the repository worker removes them as well.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        // A plain counter, not files.length: incrementing an array's own
        // .length property splices in a sparse "empty" hole before the next
        // push ever runs, so every file after the first left `files` with
        // undefined entries interleaved among the real paths.
        if (++fileCount > MAX_FILES) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
        const size = (await stat(full)).size;
        totalBytes += size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('REPOSITORY_TOO_LARGE');
        if (size <= MAX_FILE_BYTES && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
      }
    }
  }
  await walk(root);
  return files;
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

export async function scanSecrets(root: string): Promise<ScannerFinding[]> {
  const findings: ScannerFinding[] = [];
  for (const file of await collectFiles(root)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text || text.length > MAX_FILE_BYTES) continue;
    const relativePath = path.relative(root, file).replaceAll('\\', '/');
    const isTestOrCi = isTestOrCiFile(relativePath);
    for (const { pattern, title, severity, skipTestAndCiFiles, captureValue } of secretRules) {
      if (skipTestAndCiFiles && isTestOrCi) continue;
      const matched = captureValue
        ? Array.from(text.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))).some((m) => m[1] !== undefined && isPlausibleSecretValue(m[1]))
        : pattern.test(text);
      if (matched) {
        findings.push({ engineId: 'spr-secret-scanner-v1', severity, category: 'Secret', title, description: `A credential pattern was observed in ${relativePath}. The matched secret value is intentionally not persisted.` });
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

export async function scanConfiguration(root: string): Promise<ScannerFinding[]> {
  const findings: ScannerFinding[] = [];
  for (const file of await collectFiles(root)) {
    const relativePath = path.relative(root, file).replaceAll('\\', '/');
    // Every configRules pattern targets deployed/deployable configuration
    // (containers, IaC, live config wiring). A test file can only ever embed
    // a fixture string exercising this same scanner -- never real
    // configuration -- so config scanning skips test/CI paths entirely
    // rather than per-rule.
    if (isTestOrCiFile(relativePath)) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    for (const { pattern, title, severity, captureValue } of configRules) {
      const matched = captureValue
        ? Array.from(text.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))).some((m) => m[1] !== undefined && isPlausibleSecretValue(m[1]))
        : pattern.test(text);
      if (matched) findings.push({ engineId: 'spr-iac-config-scanner-v1', severity, category: 'Configuration', title, description: `A concrete configuration pattern was observed in ${relativePath}.` });
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

export function scanLicenses(cycloneDx: any, scanRoot?: string): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const components = Array.isArray(cycloneDx?.components) ? cycloneDx.components : [];
  for (const component of components) {
    if (!isLicenceEvaluable(component)) continue;
    const licenses = Array.isArray(component?.licenses) ? component.licenses : [];
    if (licenses.length === 0) {
      const name = normalizeComponentName(component?.name, scanRoot);
      findings.push({ engineId: 'spr-license-scanner-v1', severity: 'medium', category: 'License', title: 'License not observed', description: `No license declaration was present in the generated SBOM for ${name}.`, component: name });
    }
  }
  return findings;
}

export function scannerEvidenceHash(findings: ScannerFinding[]) {
  return `sha256:${digest(JSON.stringify(findings))}`;
}

export async function runRealRepositoryScanners(root: string, cycloneDx: any) {
  const [secrets, configuration] = await Promise.all([scanSecrets(root), scanConfiguration(root)]);
  const licenses = scanLicenses(cycloneDx, root);
  return { findings: [...secrets, ...configuration, ...licenses], engines: ['spr-secret-scanner-v1','spr-iac-config-scanner-v1','spr-license-scanner-v1'] };
}
