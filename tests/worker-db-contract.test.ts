import { describe, expect, it } from 'vitest';
import { rejectTlsQueryParameters } from '../src/workers/worker-db.ts';
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

// Eight consecutive worker deploys failed on 2026-09-18/19 because
// WORKER_DATABASE_URL carried ?ssl=require: pg turns that into the string
// "require", which overrides the ssl object and crashes upgradeToSSL. The
// pool must refuse such URLs with a message that names the variable.
describe('worker database URL must not carry TLS query parameters', () => {
  const base = 'postgres://u:p@postgres.railway.internal:5432/railway';

  it.each(['?ssl=require', '?sslmode=require', '?sslmode=verify-full', '?ssl=true&sslmode=require'])('rejects %s', (query) => {
    expect(() => rejectTlsQueryParameters(`${base}${query}`)).toThrow(/WORKER_DB_URL_TLS_PARAMS/);
  });

  it('accepts a URL without TLS parameters, and a missing URL', () => {
    expect(() => rejectTlsQueryParameters(base)).not.toThrow();
    expect(() => rejectTlsQueryParameters(`${base}?application_name=spr`)).not.toThrow();
    expect(() => rejectTlsQueryParameters(undefined)).not.toThrow();
  });

  it('names the variable that carries the parameter', () => {
    const previous = process.env.WORKER_DATABASE_URL;
    process.env.WORKER_DATABASE_URL = `${base}?ssl=require`;
    try {
      expect(() => rejectTlsQueryParameters(process.env.WORKER_DATABASE_URL)).toThrow(/WORKER_DATABASE_URL carries \?ssl=/);
    } finally {
      if (previous === undefined) delete process.env.WORKER_DATABASE_URL; else process.env.WORKER_DATABASE_URL = previous;
    }
  });

  it('is wired into createWorkerPool before the pool is built', () => {
    const s = read('src/workers/worker-db.ts');
    expect(s.indexOf('rejectTlsQueryParameters(connectionString)')).toBeGreaterThan(0);
    expect(s.indexOf('rejectTlsQueryParameters(connectionString)')).toBeLessThan(s.indexOf('new Pool({ connectionString'));
  });
});
