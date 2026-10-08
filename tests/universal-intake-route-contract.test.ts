import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('universal intake production route contract', () => {
  it('imports and mounts the universal intake router under /api', async () => {
    const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
    expect(server).toContain("import { createUniversalIntakeRouter } from './src/routes/universal-intake.ts';");
    const mount = "app.use('/api', createUniversalIntakeRouter());";
    expect(server.split(mount)).toHaveLength(2);
    expect(server.indexOf(mount)).toBeLessThan(server.indexOf("error: 'Route not found.'"));
  });
});
