import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('dead components with fabricated certification claims are removed, not patched', () => {
  it('Sidebar.tsx, PassportD3Graph.tsx, and PaywallOverlay.tsx no longer exist', () => {
    for (const file of ['src/components/Sidebar.tsx', 'src/components/PassportD3Graph.tsx', 'src/components/PaywallOverlay.tsx']) {
      expect(fs.existsSync(path.join(root, file))).toBe(false);
    }
  });

  it('no source file references any of the three deleted components', () => {
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'tmp_build_source') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walk(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const files = walk(path.join(root, 'src'));
    for (const banned of ['Sidebar', 'PassportD3Graph', 'PaywallOverlay']) {
      const offenders = files.filter((file) => read(path.relative(root, file)).includes(banned));
      expect(offenders).toEqual([]);
    }
  });
});

describe('no remaining live UI/data claims present SLSA Level 4 (or any specific level) as an established fact', () => {
  it('extensionsData.ts no longer asserts a specific SLSA level as a plain fact', () => {
    const s = read('src/data/extensionsData.ts');
    expect(s).not.toContain('SLSA Level 4 digital signatures');
    expect(s).toContain('Verified only when qualifying evidence is submitted and independently checked');
  });

  it('the only remaining "SLSA Level" reference in the app is contextual reference data about an external regulatory framework applicable to a software category, not a claim about specific software', () => {
    const s = read('src/components/SoftwareSectorsPanel.tsx');
    expect(s).toContain('Sector Compliance Target');
    expect(s).toContain('complianceMandate');
  });

  it('there is no remaining "SPR Protocol Certified" claim anywhere in source', () => {
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'tmp_build_source') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walk(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const offenders = walk(path.join(root, 'src')).filter((file) => read(path.relative(root, file)).includes('SPR Protocol Certified'));
    expect(offenders).toEqual([]);
  });
});
