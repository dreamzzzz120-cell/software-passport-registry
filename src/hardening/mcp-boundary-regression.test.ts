import { describe, expect, it } from 'vitest';
import { createMcpTransport } from '../mcp/transport.ts';

const TOKEN = 'spr-test-bearer-token-abcdefghijklmnopqrstuvwxyz';

describe('production MCP boundary', () => {
  const transport = createMcpTransport({
    expectedBearer: TOKEN,
    executeTool: async () => ({ status: 'OK' }),
  });

  it('fails closed without a bearer token', async () => {
    const response = await transport(new Request('https://example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(401);
  });

  it('fails closed for an incorrect bearer token', async () => {
    const response = await transport(new Request('https://example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { authorization: 'Bearer wrong-token-abcdefghijklmnopqrstuvwxyz' },
    }));
    expect(response.status).toBe(401);
  });

  it('does not expose the bearer credential in a successful response', async () => {
    const response = await transport(new Request('https://example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { authorization: `Bearer ${TOKEN}` },
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(TOKEN);
  });
});
