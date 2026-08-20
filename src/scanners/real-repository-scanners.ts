import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('REPOSITORY_PATH_INVALID');
      if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        if (++files.length > MAX_FILES) throw new Error('REPOSITORY_FILE_LIMIT_EXCEEDED');
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

const secretRules: Array<[RegExp,string,'critical'|'high'|'medium']> = [
  [/-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/, 'Private key material', 'critical'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key identifier', 'high'],
  [/gh[pousr]_[A-Za-z0-9_]{20,}/, 'GitHub token-like credential', 'high'],
  [/sk_live_[A-Za-z0-9]{16,}/, 'Stripe live secret-like credential', 'critical'],
  [/AIza[0-9A-Za-z_-]{30,}/, 'Google API key-like credential', 'high'],
  [/(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["'][^"']{12,}["']/i, 'Hard-coded credential assignment', 'high'],
];

export async function scanSecrets(root: string): Promise<ScannerFinding[]> {
  const findings: ScannerFinding[] = [];
  for (const file of await collectFiles(root)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text || text.length > MAX_FILE_BYTES) continue;
    for (const [rule, title, severity] of secretRules) {
      if (rule.test(text)) {
        findings.push({ engineId: 'spr-secret-scanner-v1', severity, category: 'Secret', title, description: `A credential pattern was observed in ${path.relative(root, file).replaceAll('\\','/')}. The matched secret value is intentionally not persisted.` });
      }
    }
  }
  return findings;
}

const configRules: Array<[RegExp,string,'critical'|'high'|'medium'|'low']> = [
  [/privileged\s*:\s*true/i, 'Privileged container enabled', 'high'],
  [/allowPrivilegeEscalation\s*:\s*true/i, 'Privilege escalation explicitly allowed', 'high'],
  [/hostNetwork\s*:\s*true/i, 'Kubernetes host networking enabled', 'high'],
  [/0\.0\.0\.0\/0/, 'World-open network range observed', 'medium'],
  [/publicly_accessible\s*=\s*true/i, 'Public accessibility enabled in IaC', 'medium'],
  [/aws_s3_bucket_public_access_block[\s\S]{0,200}block_public_(?:acls|policy)\s*=\s*false/i, 'S3 public access protection disabled', 'high'],
  [/api[_-]?key\s*[:=]\s*["'][^$<{][^"']+["']/i, 'Static API key-like configuration', 'high'],
];

export async function scanConfiguration(root: string): Promise<ScannerFinding[]> {
  const findings: ScannerFinding[] = [];
  for (const file of await collectFiles(root)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    for (const [rule, title, severity] of configRules) {
      if (rule.test(text)) findings.push({ engineId: 'spr-iac-config-scanner-v1', severity, category: 'Configuration', title, description: `A concrete configuration pattern was observed in ${path.relative(root, file).replaceAll('\\','/')}.` });
    }
  }
  return findings;
}

export function scanLicenses(cycloneDx: any): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const components = Array.isArray(cycloneDx?.components) ? cycloneDx.components : [];
  for (const component of components) {
    const licenses = Array.isArray(component?.licenses) ? component.licenses : [];
    if (licenses.length === 0) findings.push({ engineId: 'spr-license-scanner-v1', severity: 'medium', category: 'License', title: 'License not observed', description: `No license declaration was present in the generated SBOM for ${String(component?.name || 'unknown component')}.`, component: String(component?.name || 'unknown') });
  }
  return findings;
}

export function scannerEvidenceHash(findings: ScannerFinding[]) {
  return `sha256:${digest(JSON.stringify(findings))}`;
}

export async function runRealRepositoryScanners(root: string, cycloneDx: any) {
  const [secrets, configuration] = await Promise.all([scanSecrets(root), scanConfiguration(root)]);
  const licenses = scanLicenses(cycloneDx);
  return { findings: [...secrets, ...configuration, ...licenses], engines: ['spr-secret-scanner-v1','spr-iac-config-scanner-v1','spr-license-scanner-v1'] };
}
