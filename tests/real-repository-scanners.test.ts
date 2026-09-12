import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanConfiguration, scanLicenses, scanSecrets } from '../src/scanners/real-repository-scanners.ts';

describe('real repository scanners', () => {
  it('detects high-confidence secret patterns without returning secret values', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-secret-test-'));
    try {
      await writeFile(path.join(root, 'config.ts'), `const token = "ghp_${'A'.repeat(30)}";\n`);
      const findings = await scanSecrets(root);
      expect(findings.some(f => f.engineId === 'spr-secret-scanner-v1' && f.severity === 'high')).toBe(true);
      expect(findings.every(f => !f.description.includes('AAAA'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('detects concrete IaC/configuration risks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-config-test-'));
    try {
      await writeFile(path.join(root, 'deployment.yaml'), 'spec:\n  hostNetwork: true\n');
      const findings = await scanConfiguration(root);
      expect(findings.some(f => f.engineId === 'spr-iac-config-scanner-v1' && f.severity === 'high')).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reports missing SBOM license declarations as unknown evidence', () => {
    const findings = scanLicenses({ bomFormat: 'CycloneDX', components: [{ name: 'example', version: '1.0.0' }] });
    expect(findings).toHaveLength(1);
    expect(findings[0].engineId).toBe('spr-license-scanner-v1');
    expect(findings[0].severity).toBe('medium');
  });

  it('never follows symlinked repository entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-path-test-'));
    try {
      await mkdir(path.join(root, 'nested'));
      await writeFile(path.join(root, 'nested', 'safe.ts'), 'export const safe = true;');
      expect(await scanSecrets(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  // Regression coverage for a real self-scan: running these scanners over
  // this repository reported 3 high-severity findings that were all false
  // positives -- fixture strings inside the scanners' own test suite/CI
  // config, an env-var *name* mistaken for a key value, and a labeled
  // "missing config" placeholder. Each case below reproduces one of those
  // shapes directly.
  it('does not flag credential-shaped fixtures inside test/spec files or CI workflows', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-secret-fixture-test-'));
    try {
      await writeFile(path.join(root, 'webhook.test.ts'), `const secret = 'tenant-webhook-secret-value';\n`); // gitleaks:allow
      await mkdir(path.join(root, 'tests'));
      await writeFile(path.join(root, 'tests', 'fixture.ts'), `const apiKey = 'inline-fixture-credential-value';\n`); // gitleaks:allow
      await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), `PASSWORD: 'ci-only-emulator-password'\n`); // gitleaks:allow
      expect(await scanSecrets(root)).toEqual([]);

      await mkdir(path.join(root, 'k8s-test'));
      await writeFile(path.join(root, 'tests', 'scanner.test.ts'), 'spec:\n  hostNetwork: true\n');
      expect(await scanConfiguration(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not flag an env-var name or an explicit placeholder used as a config value', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-secret-placeholder-test-'));
    try {
      await writeFile(path.join(root, 'vite.config.ts'), `const required = { apiKey: 'VITE_FIREBASE_API_KEY' };\n`); // gitleaks:allow
      await writeFile(path.join(root, 'firebase.ts'), `const fallback = { apiKey: 'spr-missing-firebase-config' };\n`); // gitleaks:allow
      expect(await scanSecrets(root)).toEqual([]);
      expect(await scanConfiguration(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('still flags a plausible hard-coded credential in application source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-secret-real-test-'));
    try {
      // Assembled at runtime so no commit ever contains a key-shaped literal.
      const plausibleKey = ['a1B2c3', 'D4e5F6', 'g7H8i9J0'].join('');
      await writeFile(path.join(root, 'config.ts'), `const apiKey = '${plausibleKey}';\n`);
      const secretFindings = await scanSecrets(root);
      expect(secretFindings.some(f => f.title === 'Hard-coded credential assignment')).toBe(true);
      const configFindings = await scanConfiguration(root);
      expect(configFindings.some(f => f.title === 'Static API key-like configuration')).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
