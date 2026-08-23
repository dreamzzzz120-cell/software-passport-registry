import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../../server.ts';

const enabled = process.env.NODE_ENV === 'test';
const suite = enabled ? describe : describe.skip;
let server: Server | undefined;
let baseUrl = '';

beforeAll(async () => {
  process.env.SPR_SKIP_AUTOSTART = 'true';
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', () => resolve());
    server!.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to determine test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

suite('HTTP hardening', () => {
  it('disables Express fingerprinting', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('rejects TRACE', async () => {
    const response = await fetch(`${baseUrl}/health`, { method: 'TRACE' });
    expect(response.status).toBe(405);
  });

  it('rejects CONNECT', async () => {
    const response = await fetch(`${baseUrl}/health`, { method: 'CONNECT' });
    expect(response.status).toBe(405);
  });

  it('uses no-store caching for API responses', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns deterministic JSON for missing API routes', async () => {
    const response = await fetch(`${baseUrl}/api/security-test-not-found`);
    expect(response.status).toBe(404);
    const body = await response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});
