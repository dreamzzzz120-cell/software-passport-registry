import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverAgentConfigEvidence } from '../src/scanners/agent-config-discovery.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function entry(relativePath: string, absolutePath: string, size: number) {
  return { path: relativePath, absolutePath, size } as any;
}

describe('agent config discovery', () => {
  it('observes MCP configuration without retaining secret values and keeps identity stable across commits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-agent-discovery-'));
    roots.push(root);
    await mkdir(path.join(root, '.cursor'), { recursive: true });
    const filename = path.join(root, '.cursor', 'mcp.json');
    const body = JSON.stringify({
      mcpServers: {
        support: {
          command: '/usr/local/bin/node',
          args: ['server.js'],
          env: { SUPPORT_TOKEN: 'must-not-be-retained', REGION: 'ca' },
        },
        remoteDocs: { url: 'https://example.invalid/mcp' },
      },
    });
    await writeFile(filename, body);

    const first = await discoverAgentConfigEvidence(
      [entry('.cursor/mcp.json', filename, Buffer.byteLength(body))],
      { repository: 'owner/repo', commitSha: 'a'.repeat(40) },
    );
    const second = await discoverAgentConfigEvidence(
      [entry('.cursor/mcp.json', filename, Buffer.byteLength(body))],
      { repository: 'owner/repo', commitSha: 'b'.repeat(40) },
    );

    expect(first.assets).toHaveLength(3);
    expect(first.relationships).toHaveLength(2);
    expect(first.assets[0].sourceIdentifier).toBe(second.assets[0].sourceIdentifier);
    expect(first.assets[0].sourceIdentifier).not.toContain('a'.repeat(40));

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('must-not-be-retained');
    expect(serialized).toContain('SUPPORT_TOKEN');
    expect(serialized).toContain('network.connect');
    expect(serialized).toContain('process.execute');
    expect(first.assets.every((asset) => asset.evidenceHash.length === 64)).toBe(true);
  });

  it('observes agent-related VS Code task execution without claiming unrelated tasks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-agent-discovery-'));
    roots.push(root);
    await mkdir(path.join(root, '.vscode'), { recursive: true });
    const filename = path.join(root, '.vscode', 'tasks.json');
    const body = JSON.stringify({
      tasks: [
        { label: 'Agent', command: 'claude --continue' },
        { label: 'Build', command: 'npm run build' },
      ],
    });
    await writeFile(filename, body);

    const result = await discoverAgentConfigEvidence(
      [entry('.vscode/tasks.json', filename, Buffer.byteLength(body))],
      { repository: 'owner/repo', commitSha: 'c'.repeat(40) },
    );

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].capabilities).toEqual([
      expect.objectContaining({ capability: 'process.execute', accessMode: 'execute', targetIdentifier: 'claude --continue' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('npm run build');
  });

  it('records invalid JSON as a limitation while preserving file-level observation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spr-agent-discovery-'));
    roots.push(root);
    const filename = path.join(root, '.mcp.json');
    const body = '{not-json';
    await writeFile(filename, body);

    const result = await discoverAgentConfigEvidence(
      [entry('.mcp.json', filename, Buffer.byteLength(body))],
      { repository: 'owner/repo', commitSha: 'd'.repeat(40) },
    );

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].assetType).toBe('agent_config');
    expect(result.limitations).toContain('AGENT_CONFIG_INVALID_JSON: .mcp.json was observed and hashed but could not be structurally parsed.');
  });
});
