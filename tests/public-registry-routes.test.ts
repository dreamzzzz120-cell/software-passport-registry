import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { PgDialect } from 'drizzle-orm/pg-core';
const scope = vi.hoisted(() => vi.fn());
vi.mock('../src/middleware/tenant-scope.ts', () => ({ attachTenantScope: scope }));
vi.mock('../src/routes/free-review-submit.ts', () => ({ FREE_REVIEW_TENANT_ID: 'tenant-free-review-system' }));
import { createSoftwareRegistryRouter } from '../src/routes/software-registry';
let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; vi.restoreAllMocks(); });
async function request(path: string) {
 const app = express(); app.use('/software', createSoftwareRegistryRouter());
 server = app.listen(0, '127.0.0.1');
 await new Promise<void>(resolve => server!.once('listening', resolve));
 const address = server.address() as { port: number };
 return fetch(`http://127.0.0.1:${address.port}/software${path}`);
}
describe('public evidence route boundaries', () => {
 it('returns UNKNOWN and a recovery path when the database cannot be reached', async () => {
  scope.mockRejectedValue(new Error('getaddrinfo ENOTFOUND database.internal'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request('/expressjs/express');
  expect(response.status).toBe(503);
  const html = await response.text();
  expect(html).toContain('Evidence availability is UNKNOWN');
  expect(html).toContain('href="/registry"');
  expect(html).not.toContain('database.internal');
  expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('does not substitute an empty index on database failure', async () => {
  scope.mockRejectedValue(new Error('offline')); vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request('/index.json');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'EVIDENCE_UNAVAILABLE' });
 });
 it('preserves the repository on a genuinely unreviewed page', async () => {
  scope.mockResolvedValue({ execute: async () => ({ rows: [] }) });
  const response = await request('/expressjs/express');
  expect(response.status).toBe(404);
  expect(await response.text()).toContain('owner=expressjs&amp;repo=express');
 });
 it('binds multi-passport evidence queries as a valid parenthesized SQL list', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  scope.mockResolvedValue({ execute: async (query: any) => {
   const compiled = new PgDialect().sqlToQuery(query); queries.push(compiled);
   if (compiled.sql.includes('count(*)::int AS n FROM')) return { rows: [{ n: 2 }] };
   if (compiled.sql.includes('WITH completed')) return { rows: ['p1', 'p2'].map(passportId => ({ owner: 'acme', repository: passportId, passportId, sbom: [] })) };
   return { rows: [] };
  } });
  const response = await request('/index.json');
  expect(response.status).toBe(200);
  const detailQueries = queries.filter(query => query.sql.includes('asset_id IN'));
  expect(detailQueries).toHaveLength(2);
  for (const query of detailQueries) { expect(query.sql).toContain('asset_id IN ($2, $3)'); expect(query.params).toEqual(['tenant-free-review-system', 'p1', 'p2']); }
 });
});
