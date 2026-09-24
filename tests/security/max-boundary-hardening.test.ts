import { describe, expect, it } from 'vitest';
import { sanitizeAuditPayload } from '../src/security/audit-log.ts';
import { createMcpTransport } from '../src/mcp/transport.ts';

describe('maximum hardening: audit and MCP boundaries', () => {
  it('redacts credentials and bounds audit payloads', () => {
    const payload = JSON.parse(sanitizeAuditPayload({
      actor: 'user-1',
      authorization: 'Bearer super-secret',
      nested: { password: 'pw', normal: 'ok' },
    }));
    expect(payload.authorization).toBe('[REDACTED]');
    expect(payload.nested.password).toBe('[REDACTED]');
    expect(payload.nested.normal).toBe('ok');
    expect(Buffer.byteLength(sanitizeAuditPayload({ blob: 'x'.repeat(100_000) }), 'utf8')).toBeLessThanOrEqual(32 * 1024);
  });

  it('enforces configured MCP browser origin allowlists', async () => {
    const transport = createMcpTransport({
      expectedBearer: 'A'.repeat(32),
      allowedOrigins: ['https://www.softwarepassportregistry.com'],
      executeTool: async () => ({ ok: true }),
    });
    const bad = await transport(new Request('https://mcp.example.test', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + 'A'.repeat(32),
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    }));
    expect(bad.status).toBe(403);

    const good = await transport(new Request('https://mcp.example.test', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + 'A'.repeat(32),
        origin: 'https://www.softwarepassportregistry.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    }));
    expect(good.status).toBe(200);
  });
});
