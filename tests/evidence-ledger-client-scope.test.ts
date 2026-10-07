import express from 'express';
import type { Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('../src/middleware/security.ts', () => ({ requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/integrations/credential-vault.ts', () => ({ decryptCredentials: vi.fn() }));
vi.mock('../src/integrations/deep-collectors.ts', () => ({ collectDeepProviderEvidence: vi.fn() }));
vi.mock('../src/integrations/github-deep.ts', () => ({ collectGitHubDeepEvidence: vi.fn() }));
vi.mock('../src/trust/trust-loop.ts', () => ({ persistTrustLoop: vi.fn(), verifyRemediation: vi.fn() }));
vi.mock('../src/scanners/real-repository-scanners.ts', () => ({ isLicenceEvaluable: vi.fn(), LICENCE_SCOPE_NOTE: '' }));
import { createTrustLoopRouter } from '../src/routes/trust-loop';
let server: Server;
let database: PGlite;
let base: string;
let reads = 0;
const dialect = new PgDialect();
beforeAll(async () => {
  database = new PGlite();
  await database.exec("CREATE TABLE passports (id text, tenant_id text, client_id text); INSERT INTO passports VALUES ('own','t1','c1'), ('other-client','t1','c2'), ('other-tenant','t2','c1');");
  const app = express();
  app.use((req: any, _res, next) => {
    req.user = { tenantId: 't1', role: req.headers['x-test-role'] || 'Client', clientId: req.headers['x-test-client'] === 'missing' ? null : 'c1' };
    req.db = { execute: async (sql: any) => {
      reads++;
      const query = dialect.sqlToQuery(sql);
      if (query.sql.includes('SELECT id FROM passports')) return database.query(query.sql, query.params);
      return { rows: [] };
    } };
    next();
  });
  app.use(createTrustLoopRouter());
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (database) await database.close(); });
it('returns own ledger and refuses another client or tenant before reading evidence', async () => {
  expect((await fetch(`${base}/ledger/own`)).status).toBe(200);
  for (const id of ['other-client', 'other-tenant']) {
    reads = 0;
    expect((await fetch(`${base}/ledger/${id}`)).status).toBe(404);
    expect(reads).toBe(1);
  }
});
it('fails closed for a Client with no client ID', async () => {
  reads = 0;
  expect((await fetch(`${base}/ledger/own`, { headers: { 'x-test-client': 'missing' } })).status).toBe(404);
  expect(reads).toBe(0);
});
it('preserves MSP portfolio access within the tenant', async () => {
  expect((await fetch(`${base}/ledger/other-client`, { headers: { 'x-test-role': 'Owner' } })).status).toBe(200);
  expect((await fetch(`${base}/ledger/other-tenant`, { headers: { 'x-test-role': 'Owner' } })).status).toBe(404);
});
