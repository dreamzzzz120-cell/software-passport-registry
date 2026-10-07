import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverAgentTrust } from '../src/scanners/agent-trust-discovery.ts';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spr-agent-discovery-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('agent trust repository discovery', () => {
  it('discovers MCP configuration without persisting secret values', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['@modelcontextprotocol/server-github@1.2.3'],
          env: { GITHUB_TOKEN: 'super-secret-value-that-must-not-leak' },
        },
        remote: { url: 'https://mcp.example.test/rpc' },
      },
    }));

    const result = await discoverAgentTrust(root);
    expect(result.agents.some((x) => x.agentType === 'mcp_client')).toBe(true);
    expect(result.mcpServers.map((x) => x.name).sort()).toEqual(['github', 'remote']);
    expect(result.capabilities.some((x) => x.capability === 'shell_execution')).toBe(true);
    expect(result.capabilities.some((x) => x.capability === 'network_egress')).toBe(true);
    expect(result.boundaries.every((x) => x.state === 'UNKNOWN')).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('GITHUB_TOKEN');
    expect(serialized).not.toContain('super-secret-value-that-must-not-leak');
  });

  it('records provider source references as partial evidence, not a safety claim', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'agent.ts'), "import Anthropic from '@anthropic-ai/sdk';\nconst client = new Anthropic();");
    const result = await discoverAgentTrust(root);
    const observed = result.agents.find((x) => x.provider === 'Anthropic');
    expect(observed?.observationState).toBe('PARTIAL');
    expect(JSON.stringify(result)).not.toMatch(/safe|trusted|approved/i);
  });

  it('is deterministic for the same repository contents', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'node', args: ['server.js'] } } }));
    const first = await discoverAgentTrust(root);
    const second = await discoverAgentTrust(root);
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(second.mcpServers).toEqual(first.mcpServers);
  });
});
