/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateRealSbom } from './sbom.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('generateRealSbom license truth', () => {
  it('does not invent MIT when package license evidence is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spr-sbom-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { mystery: '1.0.0' } }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', version: '1.0.0' },
        'node_modules/mystery': { version: '1.0.0' },
      },
    }));
    const result = generateRealSbom(dir);
    expect(result.components[0]?.license).toBe('UNKNOWN');
    expect(result.components[0]?.trustLevel).toBe('Review Required');
    expect(result.cycloneDx.components[0]?.licenses?.[0]?.license.id).toBe('UNKNOWN');
    expect(result.cycloneDx.metadata.component.licenses?.[0]?.license.id).toBe('UNKNOWN');
  });
});
