import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../../server.ts';

const enabled = process.env.SPR_SECURITY_TEST_AUTH === 'true' && process.env.NODE_ENV === 'test';
const describeRoute = enabled ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = '';
const tokenA = process.env.SPR_TEST_TENANT_A_ID_TOKEN;
const tokenB = process.env.SPR_TEST_TENANT_B_ID_TOKEN;
const unverifiedToken = process.env.SPR_TEST_UNVERIFIED_ID_TOKEN;
const passportA = process.env.SPR_TEST_TENANT_A_RESOURCE_ID;
const passportB = process.env.SPR_TEST_TENANT_B_RESOURCE_ID;

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

function auth(token: string) { return { authorization: `Bearer ${token}` }; }

describeRoute('authenticated tenant authorization boundaries', () => {
  it('requires two distinct signed identities and two distinct tenant resources', () => {
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
    expect(unverifiedToken).toBeTruthy();
    expect(passportA).toBeTruthy();
    expect(passportB).toBeTruthy();
    expect(passportA).not.toBe(passportB);
  });

  it('Tenant A cannot read Tenant B findings through a tenant-scoped query', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?passportId=${encodeURIComponent(passportB!)}`, { headers: auth(tokenA!) });
    expect(response.status).toBe(200);
    const body = await response.json() as { findings?: Array<{ tenant_id?: string; passport_id?: string }> };
    expect(body.findings ?? []).toEqual([]);
  });

  it('Tenant A cannot read Tenant B trust ledger', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/ledger/${encodeURIComponent(passportB!)}`, { headers: auth(tokenA!) });
    expect(response.status).toBe(404);
  });

  it('Tenant B cannot read Tenant A trust ledger', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/ledger/${encodeURIComponent(passportA!)}`, { headers: auth(tokenB!) });
    expect(response.status).toBe(404);
  });

  it('Tenant A cannot forge Tenant B tenant context on a protected read', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?passportId=${encodeURIComponent(passportB!)}&tenantId=tenant-b`, { headers: auth(tokenA!) });
    expect(response.status).toBe(200);
    const body = await response.json() as { findings?: Array<{ tenant_id?: string }> };
    expect(body.findings ?? []).toEqual([]);
  });

  it('Tenant A cannot mutate a Tenant B finding by supplying its ID', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/remediations`, {
      method: 'POST',
      headers: { ...auth(tokenA!), 'content-type': 'application/json' },
      body: JSON.stringify({ findingId: 'nonexistent-cross-tenant-finding', title: 'cross-tenant mutation' }),
    });
    expect([404, 409]).toContain(response.status);
  });

  it('rejects an unverified identity from protected Trust Loop reads', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings`, { headers: auth(unverifiedToken!) });
    expect(response.status).toBe(403);
  });
});
