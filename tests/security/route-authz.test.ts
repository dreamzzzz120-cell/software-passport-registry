import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../../server.ts';

/**
 * Real HTTP boundary tests. Authentication is intentionally supplied by the
 * test environment through SPR_SECURITY_TEST_AUTH rather than by bypassing
 * middleware. The suite is skipped unless an isolated test auth provider is
 * configured, so it can never accidentally exercise production credentials.
 */
const enabled = process.env.SPR_SECURITY_TEST_AUTH === 'true' && process.env.NODE_ENV === 'test';
const describeRoute = enabled ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = '';

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

describeRoute('route-level authorization boundaries', () => {
  it('rejects unauthenticated access to protected trust-loop reads', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings`);
    expect([401, 403]).toContain(response.status);
  });

  it('rejects unauthenticated cross-tenant mutation attempts', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/remediations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ findingId: 'other-tenant-finding', title: 'unauthorized' }),
    });
    expect([401, 403]).toContain(response.status);
  });

  it('rejects unauthenticated evidence verification attempts', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ findingId: 'other-tenant-finding', observationIds: ['other-observation'], evidenceIds: ['other-evidence'] }),
    });
    expect([401, 403]).toContain(response.status);
  });

  it('does not accept a client supplied tenant identifier as authentication', async () => {
    const response = await fetch(`${baseUrl}/api/trust-loop/findings?tenantId=attacker-controlled-tenant`);
    expect([401, 403]).toContain(response.status);
  });
});
