import { describe, expect, it } from 'vitest';
import { MCP_TOOLS, constantTimeEquals, hashAgentClaim, redactForAgent } from '../src/mcp/server.ts';
import { createMcpTransport } from '../src/mcp/transport.ts';

describe('SPR MCP hardening', () => {
  it('exposes only the approved read-only tools', () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    expect(names).toEqual([
      'verify_software',
      'get_passport',
      'get_trust_evidence',
      'get_security_status',
      'get_compliance_status',
      'check_freshness',
      'verify_claim',
    ]);
    for (const tool of MCP_TOOLS) expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it('redacts nested credentials and session material', () => {
    const result = redactForAgent({ safe: 'ok', apiKey: 'secret', nested: { authorization: 'Bearer secret', cookie: 'session', value: 1 }, list: [{ password: 'pw', value: 2 }] });
    expect(result).toEqual({ safe: 'ok', nested: { value: 1 }, list: [{ value: 2 }] });
  });

  it('normalizes Unicode claims before hashing without changing ordinary whitespace', () => {
    expect(hashAgentClaim('Café')).toBe(hashAgentClaim('Cafe\u0301'));
    expect(hashAgentClaim('  TRUST   THIS  ')).not.toBe(hashAgentClaim('TRUST THIS'));
    expect(hashAgentClaim('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('uses constant-time comparison semantics', () => {
    expect(constantTimeEquals('same', 'same')).toBe(true);
    expect(constantTimeEquals('same', 'different')).toBe(false);
    expect(constantTimeEquals('short', 'longer')).toBe(false);
  });

  it('accepts the initialized message as a spec-compliant notification without an id', async () => {
    const token = 'a'.repeat(64);
    const transport = createMcpTransport({ expectedBearer: token, executeTool: async () => ({ ok: true }) });
    const initialize = await transport(new Request('https://spr.example/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } }),
    }));
    expect(initialize.status).toBe(200);
    const session = initialize.headers.get('mcp-session-id');
    expect(session).toBeTruthy();

    const initialized = await transport(new Request('https://spr.example/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-session-id': session! },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }));
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe('');
  });
});
