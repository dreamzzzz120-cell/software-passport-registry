import { describe, expect, it } from 'vitest';
import { normalizeWorkerConnectionString, rejectTlsQueryParameters } from '../src/workers/worker-db.ts';
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

  it('normalizes Railway sslmode=require when independent SQL_SSL enforces equal or stronger TLS', () => {
    const normalized = normalizeWorkerConnectionString(`${base}?sslmode=require&application_name=spr`, 'require');
    expect(normalized).toBeDefined();
    const parsed = new URL(normalized!);
    expect(parsed.searchParams.has('sslmode')).toBe(false);
    expect(parsed.searchParams.get('application_name')).toBe('spr');
    for (const mode of ['verify', 'verify-full']) {
      const secured = normalizeWorkerConnectionString(`${base}?sslmode=require&application_name=spr`, mode);
      expect(new URL(secured!).searchParams.has('sslmode')).toBe(false);
      expect(new URL(secured!).searchParams.get('application_name')).toBe('spr');
    }
    expect(() => normalizeWorkerConnectionString(`${base}?sslmode=require`, 'false')).toThrow(/WORKER_DB_URL_TLS_PARAMS/);
    expect(() => normalizeWorkerConnectionString(`${base}?sslmode=disable`, 'require')).toThrow(/WORKER_DB_URL_TLS_PARAMS/);
    expect(() => normalizeWorkerConnectionString(`${base}?ssl=require`, 'require')).toThrow(/WORKER_DB_URL_TLS_PARAMS/);
  });

  it('is wired into createWorkerPool before the pool is built', () => {
    const s = read('src/workers/worker-db.ts');
    expect(s.indexOf('normalizeWorkerConnectionString(rawConnectionString, mode)')).toBeGreaterThan(0);
    expect(s.indexOf('normalizeWorkerConnectionString(rawConnectionString, mode)')).toBeLessThan(s.indexOf('new Pool({ connectionString'));
  });
});


describe('all cross-tenant workers use the hardened worker pool', () => {
  it('webhook delivery never constructs an owner DATABASE_URL pool directly', () => {
    const s = read('src/workers/webhook-worker.ts');
    expect(s).toContain("import { createWorkerPool } from './worker-db.ts'");
    expect(s).toContain('const pool = createWorkerPool();');
    expect(s).not.toContain('new Pool({ connectionString: process.env.DATABASE_URL');
  });

  it('report schedules use the hardened worker pool', () => {
    const s = read('src/workers/report-schedule-worker.ts');
    expect(s).toContain("createWorkerPool");
    expect(s).not.toContain('new Pool({ connectionString: process.env.DATABASE_URL');
  });

  it('trust monitoring uses the hardened worker pool', () => {
    const s = read('src/workers/trust-monitoring-worker.ts');
    expect(s).toContain("createWorkerPool");
    expect(s).not.toContain('new Pool({ connectionString: process.env.DATABASE_URL');
  });
});


describe('worker mutation tenant-binding guard', () => {
  const workerFiles = [
    'src/workers/distribution-worker.ts',
    'src/workers/intake-scan-worker.ts',
    'src/workers/notification-worker.ts',
    'src/workers/osv-worker.ts',
    'src/workers/registry-crawler-worker.ts',
    'src/workers/registry-lineage-worker.ts',
    'src/workers/report-schedule-worker.ts',
    'src/workers/retention-worker.ts',
    'src/workers/security-scanner-worker.ts',
    'src/workers/trust-monitoring-worker.ts',
    'src/workers/webhook-worker.ts',
  ];

  it('does not allow workers to open a direct owner DATABASE_URL connection', () => {
    for (const file of workerFiles) {
      const source = read(file);
      expect(source, file).not.toContain('connectionString: process.env.DATABASE_URL');
      expect(source, file).not.toContain('connectionString:process.env.DATABASE_URL');
    }
  });

  it('requires the cross-tenant worker privilege to remain explicit and non-BYPASSRLS', () => {
    const migration = read('migrations/0108_reassert_worker_cross_tenant_policies.sql');
    expect(migration).toContain('CREATE POLICY spr_worker_cross_tenant');
    expect(migration).toContain('TO spr_worker_runtime');
    expect(migration).not.toMatch(/ALTER ROLE\s+spr_worker_runtime\s+.*BYPASSRLS/i);
  });
});
