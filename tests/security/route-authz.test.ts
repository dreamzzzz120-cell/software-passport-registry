import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../../server.ts';

const enabled = process.env.SPR_SECURITY_TEST_AUTH === 'true' && process.env.NODE_ENV === 'test';
const describeRoute = enabled ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = '';

const tokenA = process.env.SPR_TEST_TENANT_A_ID_TOKEN;
const tokenB = process.env.SPR_TEST_TENANT_B_ID_TOKEN;
const fixtureA = process.env.SPR_TEST_TENANT_A_RESOURCE_ID;
const fixtureB = process.env.SPR_TEST_TENANT_B_RESOURCE_ID;

beforeAll(async () => {
  if (!enabled) return;
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
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describeRoute('authenticated tenant authorization boundaries', () => {
  it('requires isolated Tenant A/B signed tokens before authenticated tests execute', () => {
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
    expect(fixtureA).toBeTruthy();
    expect(fixtureB).toBeTruthy();
    expect(fixtureA).not.toBe(fixtureB);
  });

  it('Tenant A cannot read Tenant B resource', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings/${encodeURIComponent(fixtureB!)}`, { headers: auth(tokenA!) });
    expect([403, 404]).toContain(response.status);
  });

  it('Tenant A cannot mutate Tenant B resource', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/remediations`, {
      method: 'POST',
      headers: { ...auth(tokenA!), 'content-type': 'application/json' },
      body: JSON.stringify({ findingId: fixtureB, title: 'cross-tenant mutation' }),
    });
    expect([403, 404]).toContain(response.status);
  });

  it('Tenant A cannot substitute Tenant B identity through the body', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/remediations`, {
      method: 'POST',
      headers: { ...auth(tokenA!), 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: process.env.SPR_TEST_TENANT_B_UID, findingId: fixtureB, title: 'forged tenant' }),
    });
    expect([403, 404]).toContain(response.status);
  });

  it('Tenant B cannot mutate Tenant A resource', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/remediations`, {
      method: 'POST',
      headers: { ...auth(tokenB!), 'content-type': 'application/json' },
      body: JSON.stringify({ findingId: fixtureA, title: 'cross-tenant mutation' }),
    });
    expect([403, 404]).toContain(response.status);
  });
});
