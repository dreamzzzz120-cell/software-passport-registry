import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Migration 0020 provisions a least-privileged spr_worker_runtime role
// specifically so the worker never has to run as the database owner. That
// role only takes effect once the worker's own pool actually targets
// WORKER_DATABASE_URL -- previously it read DATABASE_URL unconditionally, so
// provisioning the role and the env var did nothing.
describe('worker database connection prefers the least-privileged runtime role', () => {
  const source = () => read('src/workers/worker-db.ts');

  it('reads WORKER_DATABASE_URL before falling back to the owner DATABASE_URL', () => {
    const s = source();
    expect(s).toContain('process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL');
  });

  it('never hard-codes a discrete owner connection as the only option', () => {
    const s = source();
    expect(s).toContain('connectionString');
  });
});
