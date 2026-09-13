import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

async function collectTestFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(path));
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function findSilentEnvironmentGates(source: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['describeIfConfigured helper', /describeIfConfigured\s*\(/],
    ['suite gated by an environment variable', /if\s*\(\s*!?\s*process\.env\.[A-Z0-9_]+\s*\)\s*\{[\s\S]{0,600}?\b(?:describe|suite)\s*\(/],
    ['Vitest suite skipIf environment gate', /\b(?:describe|suite)\.skipIf\s*\(\s*(?:process\.env\.|!!?\s*process\.env\.)/],
    ['Vitest suite conditional environment gate', /\b(?:describe|suite)\s*\.?(?:skip|only)?\s*\(\s*process\.env\./],
  ];
  return patterns.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

function isExplicitlyDocumentedGate(file: string, source: string): boolean {
  // This is the one intentional infrastructure gate: the RLS regression suite
  // requires the restricted runtime database connection. The suite remains a
  // real test and CI supplies APP_DATABASE_URL in the security-route workflow.
  return file.endsWith('tests/security/rls-tenant-isolation.test.ts')
    && source.includes('process.env.APP_DATABASE_URL')
    && source.includes('const describeIfConfigured = appDatabaseUrl ? describe : describe.skip;');
}

describe('test suite execution invariants', () => {
  it('does not contain silently environment-gated test suites', async () => {
    const testsRoot = join(process.cwd(), 'tests');
    const contractFile = relative(process.cwd(), __filename).replaceAll('\\', '/');
    const files = await collectTestFiles(testsRoot);
    const findings: string[] = [];

    for (const file of files) {
      const relativeFile = relative(process.cwd(), file).replaceAll('\\', '/');
      // The detector necessarily contains the patterns it is designed to detect.
      if (relativeFile === contractFile) continue;

      const source = await readFile(file, 'utf8');
      if (isExplicitlyDocumentedGate(file, source)) continue;
      for (const finding of findSilentEnvironmentGates(source)) {
        findings.push(`${file}: ${finding}`);
      }
    }

    expect(findings, `Environment-gated test suites must be explicit and CI-backed.\n${findings.join('\n')}`).toEqual([]);
  });
});
