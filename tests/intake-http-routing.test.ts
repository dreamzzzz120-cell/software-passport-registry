import express from 'express';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), download: vi.fn(), sign: vi.fn(), remove: vi.fn() }));
vi.mock('../src/db/index.ts', () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
vi.mock('../src/integrations/intake-storage.ts', () => ({ downloadIntakeObject: mocks.download, createIntakeSignedUpload: mocks.sign, deleteIntakeObject: mocks.remove }));
// Exercise the route's ownership checks independently of token verification.
// Production token verification and database RLS still require acceptance.
vi.mock('../src/middleware/security.ts', () => ({ requireAuth: (req: any, res: any, next: any) => {
  const tenant = req.headers['x-test-tenant'];
  if (!tenant) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.user = { tenantId: tenant, uid: 'test-user' };
  next();
} }));
import { createUniversalIntakeRouter } from '../src/routes/universal-intake.ts';

const sessionId = `intake_${'a'.repeat(32)}`;
const itemId = `item_${'b'.repeat(32)}`;
const openSession = { id: sessionId, status: 'OPEN', expiresAt: '2099-01-01', tenantId: null };
let server: Server;
let origin: string;
async function post(path: string, body: unknown, tenant?: string) {
  return fetch(`${origin}/api/intake/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tenant ? { 'x-test-tenant': tenant } : {}) }, body: JSON.stringify(body) });
}

describe('intake HTTP route behavior (mocked persistence and broker)', () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createUniversalIntakeRouter());
    app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND' }));
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ error: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  beforeEach(() => { vi.resetAllMocks(); });

  it('reaches every intake endpoint before the generic fallback', async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const created = await post('session', {});
    expect(created.status).toBe(201);
    expect((await created.json()).sessionId).toMatch(/^intake_[a-f0-9]{32}$/);
    for (const path of ['upload-url', 'complete']) {
      const response = await post(path, {});
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty('code', 'NOT_FOUND');
    }
    const lookup = await fetch(`${origin}/api/intake/session/invalid`);
    expect(lookup.status).toBe(404);
    expect(await lookup.json()).toEqual({ error: 'Intake session not found.' });
    expect((await post('claim', { sessionId })).status).toBe(401);
  });

  it('releases the upload reservation when the broker is not configured', async () => {
    mocks.transaction.mockImplementation(async callback => callback({ execute: vi.fn()
      .mockResolvedValueOnce({ rows: [openSession] })
      .mockResolvedValueOnce({ rows: [{ count: 0, total_size: 0 }] })
      .mockResolvedValueOnce({ rows: [] }) }));
    mocks.sign.mockRejectedValue(Object.assign(new Error('INTAKE_BROKER_NOT_CONFIGURED'), { status: 503 }));
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await post('upload-url', { sessionId, file: { name: 'package.json', size: 2, contentType: 'application/json', kind: 'software' } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'INTAKE_BROKER_NOT_CONFIGURED' });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0].queryChunks.map((chunk: any) => chunk.value ?? '').flat().join('')).toContain("SET status='FAILED'");
  });

  it('persists the hash of downloaded bytes rather than the client hash', async () => {
    const bytes = Buffer.from('{}');
    const hash = createHash('sha256').update(bytes).digest('hex');
    mocks.execute.mockResolvedValueOnce({ rows: [openSession] })
      .mockResolvedValueOnce({ rows: [{ id: itemId, name: 'package.json', size: bytes.length, bucket: 'spr-intake', path: 'object', status: 'AWAITING_UPLOAD' }] })
      .mockResolvedValueOnce({ rows: [{ id: itemId, sha256: hash, status: 'UPLOADED' }] });
    mocks.download.mockResolvedValue(bytes);
    const response = await post('complete', { sessionId, itemId, sha256: '0'.repeat(64) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sha256: hash, status: 'UPLOADED' });
    expect(mocks.execute.mock.calls[2][0].queryChunks).toContain(hash);
  });

  it('does not mark an unreadable object uploaded', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [openSession] })
      .mockResolvedValueOnce({ rows: [{ id: itemId, status: 'AWAITING_UPLOAD' }] });
    mocks.download.mockRejectedValue(new Error('STORAGE_UNAVAILABLE'));
    expect((await post('complete', { sessionId, itemId })).status).toBe(422);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('rejects another tenant without modifying the session or items', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ ...openSession, tenantId: 'tenant-a', status: 'CLAIMED' }] });
    const response = await post('claim', { sessionId }, 'tenant-b');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Intake belongs to another workspace.' });
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
