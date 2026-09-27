import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { listRevenueReviewCandidates } from '../src/agents/revenue-query.ts';
import type { ScopedDb } from '../src/middleware/tenant-scope.ts';

const pg = new PGlite();
const dialect = new PgDialect();
const db = { execute: (query: any) => { const { sql, params } = dialect.sqlToQuery(query); return pg.query(sql, params); } } as ScopedDb;
const now = new Date('2026-09-26T08:00:00Z');

beforeAll(async () => {
  await pg.exec(`CREATE TABLE passports (id text PRIMARY KEY, tenant_id text, client_id text);
    CREATE TABLE trust_findings (id text PRIMARY KEY, tenant_id text, passport_id text, title text,
      severity text, status text, evidence_ids text, updated_at text);
    CREATE TABLE evidence_ledger (id text PRIMARY KEY, tenant_id text, passport_id text,
      status text, observed_at text, verification_method text, evidence_hash text);`);
  await pg.query('INSERT INTO passports VALUES ($1,$2,$3),($4,$5,$6)', ['pa','tenant-a','ca','pb','tenant-b','cb']);
  await pg.query('INSERT INTO trust_findings VALUES ($1,$2,$3,$4,$5,$6,$7,$8),($9,$10,$11,$12,$13,$14,$15,$16)',
    ['fa','tenant-a','pa','A gap','high','OPEN','["ea"]',now.toISOString(),
      'fb','tenant-b','pb','B gap','critical','OPEN','["eb"]',now.toISOString()]);
  await pg.query('INSERT INTO evidence_ledger VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14)',
    ['ea','tenant-a','pa','FAIL',now.toISOString(),'provider_api','a'.repeat(64),
      'eb','tenant-b','pb','FAIL',now.toISOString(),'provider_api','b'.repeat(64)]);
});
afterAll(async () => { await pg.close(); });

describe('machine revenue query', () => {
  it('keeps candidates and evidence within the authenticated tenant', async () => {
    const a = await listRevenueReviewCandidates(db, 'tenant-a', { limit: 25 });
    const b = await listRevenueReviewCandidates(db, 'tenant-b', { limit: 25 });
    expect(a.opportunities.map(x => x.findingId)).toEqual(['fa']);
    expect(a.opportunities[0].evidenceIds).toEqual(['ea']);
    expect(b.opportunities.map(x => x.findingId)).toEqual(['fb']);
  });
  it('filters by client and returns no invented money', async () => {
    const result = await listRevenueReviewCandidates(db, 'tenant-a', { clientId: 'cb', limit: 25 });
    expect(result.opportunities).toEqual([]);
    expect(result.estimatedValue).toBeNull();
  });
});
