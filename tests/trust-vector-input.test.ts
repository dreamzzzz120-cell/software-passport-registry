import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import express from 'express';
import type { Server } from 'node:http';
vi.mock('../src/middleware/security.ts', () => ({ requireAuth: (_req: any, _res: any, next: any) => next(), rateLimiter: (_req: any, _res: any, next: any) => next() }));
import { createTrustVectorRouter, loadTrustVectorInput, loadTrustVectorPassport } from '../src/routes/trust-vector';
import { computeTrustVector } from '../src/trust/trust-vector';

const pg = new PGlite();
const dialect = new PgDialect();
const db = { execute: (query: any) => { const built = dialect.sqlToQuery(query); return pg.query(built.sql, built.params); } };
let server: Server;
let origin: string;
let clientId: string | null = 'client-a';
beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE passports (id text, tenant_id text, client_id text, publisher text, sbom text, evidence_completeness integer);
    INSERT INTO passports VALUES ('own','tenant-a','client-a',NULL,'{"components":[{},{}]}',NULL), ('other-client','tenant-a','client-b',NULL,'[]',NULL), ('other-tenant','tenant-b','client-a',NULL,'[]',NULL);
    CREATE TABLE agent_jobs (id text, tenant_id text, passport_id text, job_type text, updated_at timestamp, status text);
    CREATE TABLE repository_scan_sources (job_id text, tenant_id text, acquired_at timestamp);
    CREATE TABLE trust_observations (tenant_id text, passport_id text, generated_at timestamp);
    CREATE TABLE scan_findings (id text, tenant_id text, asset_id text, severity text, category text, status text, detected_at text, fixed_version text, component text, updated_at text);
    CREATE TABLE evidence_items (id text, tenant_id text, asset_id text, type text, verified integer, status text, timestamp text);
    CREATE TABLE monitoring_configurations (id text, tenant_id text, passport_id text, enabled integer, last_status text, last_successful_at text);
    CREATE TABLE trust_remediation_work_items (id text, tenant_id text, passport_id text, status text);
    INSERT INTO scan_findings VALUES ('legacy-date','tenant-a','own','Low','Configuration','Open',NULL,NULL,NULL,'not-a-date');
  `);
  await pg.exec(fs.readFileSync(new URL('../migrations/0089_passport_trust_vectors.sql', import.meta.url), 'utf8'));
  const app = express();
  app.use((req: any, _res, next) => { req.db = db; req.user = { role: 'Client', tenantId: 'tenant-a', clientId }; next(); });
  app.use(createTrustVectorRouter());
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30_000);
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); });

describe('trust vector inputs and persistence', () => {
  it('allows a client to read only its own passport, including within the same tenant', async () => {
    expect(await loadTrustVectorPassport(db, 'tenant-a', 'own', 'client-a')).not.toBeNull();
    expect(await loadTrustVectorInput(db, 'tenant-a', 'other-client', 'client-a')).toBeNull();
    expect(await loadTrustVectorInput(db, 'tenant-a', 'other-tenant', 'client-a')).toBeNull();
    expect(await loadTrustVectorPassport(db, 'tenant-a', 'other-client')).not.toBeNull();
  });
  it('handles CycloneDX SBOMs and malformed legacy dates without fabricating measurements', async () => {
    const input = await loadTrustVectorInput(db, 'tenant-a', 'own', 'client-a');
    expect(input?.sbomComponentCount).toBe(2);
    expect(input?.evidenceCompleteness).toBeNull();
    expect(input?.findings[0].updatedAt).toBeNull();
    expect(input?.lastDependencyScanCompletedAt).toBeNull();
    const vector = computeTrustVector(input!);
    expect(vector.unknownCount).toBeGreaterThan(0);
    await db.execute(sql`INSERT INTO passport_trust_vectors (id, tenant_id, passport_id, version, vector_json, computed_at) VALUES ('test-vector', 'tenant-a', 'own', ${vector.version}, ${JSON.stringify(vector)}::jsonb, ${vector.computedAt}::timestamp)`);
    const saved = await pg.query<{ vector_json: typeof vector }>("SELECT vector_json FROM passport_trust_vectors WHERE id='test-vector'");
    expect(saved.rows[0].vector_json).toEqual(vector);
  });
  it('returns scoped results and persists a successful recompute through the real HTTP route', async () => {
    const response = await fetch(`${origin}/own`);
    expect(response.status).toBe(200);
    const vector = await response.json();
    expect(vector.authoritative).toBe(false);
    const history = await fetch(`${origin}/own/history`).then(response => response.json());
    expect(history.history.some((row: any) => row.id === vector.id)).toBe(true);
  });
  it.each(['other-client', 'other-tenant'])('blocks both computation and history for %s', async passportId => {
    expect((await fetch(`${origin}/${passportId}`)).status).toBe(404);
    expect((await fetch(`${origin}/${passportId}/history`)).status).toBe(404);
  });
  it('fails closed when a Client has no assigned client scope', async () => {
    clientId = null;
    try { expect((await fetch(`${origin}/own`)).status).toBe(403); }
    finally { clientId = 'client-a'; }
  });
});
