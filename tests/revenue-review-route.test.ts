import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();
const reviews = new Map<string, { id: string; findingId: string; action: string }>();
const queries: Array<{ sql: string; params: unknown[] }> = [];
const now = new Date().toISOString();
const fakeDb = { async execute(query: any) {
  const { sql, params } = dialect.sqlToQuery(query);
  queries.push({ sql, params });
  if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
  if (sql.includes('FROM revenue_opportunity_reviews') && sql.includes('idempotency_key')) return { rows: [reviews.get(String(params[1]))].filter(Boolean) };
  if (sql.includes('FROM trust_findings f JOIN passports p')) return { rows: [{ id: 'f1', passportId: 'p1', clientId: 'c1', title: 'Gap', severity: 'high', status: 'OPEN', evidenceIds: '["e1"]', updatedAt: now }] };
  if (sql.includes('FROM evidence_ledger')) return { rows: [{ id: 'e1', passportId: 'p1', status: 'FAIL', observedAt: now, verificationMethod: 'provider_api', evidenceHash: 'a'.repeat(64) }] };
  if (sql.includes('INSERT INTO revenue_opportunity_reviews')) {
    reviews.set(String(params[8]), { id: String(params[0]), findingId: String(params[2]), action: String(params[5]) });
    return { rows: [] };
  }
  if (sql.includes('FROM spr_webhooks')) return { rows: [] };
  throw new Error(`Unexpected query: ${sql}`);
} };

vi.mock('../src/middleware/security.ts', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { tenantId: 'tenant-a', uid: 'operator-a', role: req.headers.authorization === 'Bearer client' ? 'Client' : 'Operator' };
    req.db = fakeDb;
    next();
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: any) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden' })
}));
vi.mock('../src/security/audit-log.ts', () => ({ appendAuditEntry: vi.fn(async () => undefined) }));

let server: Server;
let base: string;
beforeAll(async () => {
  const { createRevenueRouter } = await import('../src/routes/revenue.ts');
  const app = express(); app.use(express.json()); app.use('/api/revenue', createRevenueRouter());
  app.use((_err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: 'INTERNAL' }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

const post = (body: object, token = 'operator') => fetch(`${base}/api/revenue/reviews`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
});

describe('human review boundary', () => {
  it('requires a permitted user and a current supported candidate', async () => {
    expect((await post({ findingId: 'f1', action: 'ACCEPTED_FOR_REVIEW', idempotencyKey: 'first-key-0001' }, 'client')).status).toBe(403);
    const response = await post({ findingId: 'f1', action: 'ACCEPTED_FOR_REVIEW', idempotencyKey: 'first-key-0001' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(expect.objectContaining({ findingId: 'f1', evidenceIds: ['e1'], requiresHumanApprovalForExternalAction: true }));
    expect(queries.some(q => q.sql.includes('FROM trust_findings f JOIN passports p') && q.params.includes('tenant-a'))).toBe(true);
  });
  it('reuses an idempotency key only for the same decision', async () => {
    expect((await post({ findingId: 'f1', action: 'ACCEPTED_FOR_REVIEW', idempotencyKey: 'first-key-0001' })).status).toBe(200);
    expect((await post({ findingId: 'f1', action: 'DISMISSED', idempotencyKey: 'first-key-0001' })).status).toBe(409);
  });
});
