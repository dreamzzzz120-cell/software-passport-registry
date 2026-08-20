import { describe, expect, it } from 'vitest';
import { MCP_TOOLS, constantTimeEquals, hashAgentClaim, redactForAgent } from '../src/mcp/server.ts';

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
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('redacts nested credentials and session material', () => {
    const result = redactForAgent({
      safe: 'ok',
      apiKey: 'secret',
      nested: { authorization: 'Bearer secret', cookie: 'session', value: 1 },
      list: [{ password: 'pw', value: 2 }],
    });
    expect(result).toEqual({ safe: 'ok', nested: { value: 1 }, list: [{ value: 2 }] });
  });

  it('hashes normalized claims deterministically', () => {
    expect(hashAgentClaim('  TRUST   THIS  ')).toBe(hashAgentClaim('TRUST THIS'));
    expect(hashAgentClaim('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('uses constant-time comparison semantics', () => {
    expect(constantTimeEquals('same', 'same')).toBe(true);
    expect(constantTimeEquals('same', 'different')).toBe(false);
    expect(constantTimeEquals('short', 'longer')).toBe(false);
  });
});
