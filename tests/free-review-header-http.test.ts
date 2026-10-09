import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock('../src/config.ts', () => ({ config: { publicPassport: { secret: 'local-test-fixture-only' } } }));
vi.mock('../src/db/index.ts', () => ({ db: {} }));
vi.mock('../src/middleware/security.ts', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('../src/security/entitlements.ts', () => ({ enforceCapability: vi.fn() }));
vi.mock('../src/middleware/tenant-scope.ts', () => ({ attachTenantScope: mocks.scope }));
import { createLegacyFreeReviewRouter, FREE_REVIEW_TENANT_ID } from '../src/routes/free-review-legacy';
import { signFreeReviewStatusToken } from '../src/routes/public-connect';
let server: Server;
let origin: string;
const id = 'passport_fixture';
describe('Free Review header transport over HTTP', () => {
  beforeAll(async () => {
    mocks.scope.mockResolvedValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
    const app = express(); app.use('/api', createLegacyFreeReviewRouter());
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  it('rejects missing, tampered, expired and mismatched credentials before database access', async () => {
    mocks.scope.mockClear();
    const future = Math.floor(Date.now() / 1000) + 60;
    const valid = signFreeReviewStatusToken(id, future);
    for (const token of ['', valid + 'x', signFreeReviewStatusToken(id, 1), signFreeReviewStatusToken('other', future)]) {
      const response = await fetch(`${origin}/api/free-review/scan/${id}/status`, { method: 'POST', headers: { 'x-spr-review-status-token': token } });
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect(mocks.scope).not.toHaveBeenCalled();
  });
  it('accepts a bound signed header and scopes lookup to the Free Review tenant', async () => {
    mocks.scope.mockClear();
    const token = signFreeReviewStatusToken(id, Math.floor(Date.now() / 1000) + 60);
    const response = await fetch(`${origin}/api/free-review/scan/${id}/status`, { method: 'POST', headers: { 'x-spr-review-status-token': token } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Free Review submission not found' });
    expect(mocks.scope.mock.calls[0][0]).toBe(FREE_REVIEW_TENANT_ID);
  });
});
