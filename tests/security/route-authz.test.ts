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
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function auth(token: string) { return { authorization: `Bearer ${token}` }; }

describeRoute('authenticated tenant authorization boundaries', () => {
  it('requires distinct signed identities and resources', () => {
    expect(tokenA).toBeTruthy(); expect(tokenB).toBeTruthy(); expect(unverifiedToken).toBeTruthy();
    expect(tokenA).not.toBe(tokenB); expect(passportA).toBeTruthy(); expect(passportB).toBeTruthy();
    expect(passportA).not.toBe(passportB);
  });

  it('DIAGNOSTIC: print the actual 403 body', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?passportId=${encodeURIComponent(passportB!)}`, { headers: auth(tokenA!) });
    const bodyText = await response.text();
    console.log('DIAG_STATUS=' + response.status);
    console.log('DIAG_BODY=' + bodyText);
    // Also print what the token itself decodes to, and what's actually in the
    // users table, so a mismatch between them is visible directly rather than
    // inferred.
    const [, payloadB64] = tokenA!.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    console.log('DIAG_TOKEN_UID=' + payload.user_id);
    console.log('DIAG_TOKEN_EMAIL=' + payload.email);
    console.log('DIAG_TOKEN_EMAIL_VERIFIED=' + payload.email_verified);
    console.log('DIAG_SEEDED_UID=' + process.env.SPR_TEST_TENANT_A_UID);
  });

  it('Tenant A cannot observe Tenant B findings', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?passportId=${encodeURIComponent(passportB!)}`, { headers: auth(tokenA!) });
    expect(response.status).toBe(200);
    const body = await response.json() as { findings?: Array<{ tenant_id?: string; passport_id?: string }> };
    for (const finding of body.findings ?? []) {
      expect(finding.tenant_id).toBe('tenant-a');
      expect(finding.passport_id).not.toBe(passportB);
    }
  });

  it('Tenant B cannot observe Tenant A findings', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?passportId=${encodeURIComponent(passportA!)}`, { headers: auth(tokenB!) });
    expect(response.status).toBe(200);
    const body = await response.json() as { findings?: Array<{ tenant_id?: string; passport_id?: string }> };
    for (const finding of body.findings ?? []) {
      expect(finding.tenant_id).toBe('tenant-b');
      expect(finding.passport_id).not.toBe(passportA);
    }
  });

  it('Tenant A cannot read Tenant B trust ledger', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/ledger/${encodeURIComponent(passportB!)}`, { headers: auth(tokenA!) });
    expect(response.status).toBe(404);
  });

  it('Tenant B cannot read Tenant A trust ledger', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/ledger/${encodeURIComponent(passportA!)}`, { headers: auth(tokenB!) });
    expect(response.status).toBe(404);
  });

  it('client tenantId cannot override authenticated tenant', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?passportId=${encodeURIComponent(passportB!)}&tenantId=tenant-b`, { headers: auth(tokenA!) });
    expect(response.status).toBe(200);
    const body = await response.json() as { findings?: Array<{ tenant_id?: string }> };
    for (const finding of body.findings ?? []) expect(finding.tenant_id).toBe('tenant-a');
  });

  it('rejects unverified identity from protected Trust Loop reads', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings`, { headers: auth(unverifiedToken!) });
    expect(response.status).toBe(403);
  });
});
