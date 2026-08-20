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
});
