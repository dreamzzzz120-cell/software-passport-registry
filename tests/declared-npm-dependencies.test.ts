import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectDeclaredNpmDependencies } from '../src/workers/osv-worker.ts';

describe('declared npm dependency evidence', () => {
  it('records package.json declarations without pretending ranges are resolved versions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-declared-npm-'));
    try {
      await mkdir(path.join(root, 'nested'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), JSON.stringify({
        dependencies: { express: '^5.1.0', accepts: '^2.0.0' },
        devDependencies: { vitest: '^3.2.4' },
        peerDependencies: { react: '>=18' },
        optionalDependencies: { fsevents: '^2.3.3' },
      }));
      const result = await collectDeclaredNpmDependencies(root, ['package.json']);
      expect(result).toMatchObject({ total: 5, production: 2, development: 1, peer: 1, optional: 1 });
      expect(result?.records).toContainEqual({ name: 'express', declaredRange: '^5.1.0', group: 'dependencies' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null when no package.json was observed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-no-package-json-'));
    try {
      expect(await collectDeclaredNpmDependencies(root, ['go.mod'])).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
