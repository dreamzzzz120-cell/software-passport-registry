import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { InventoryEntry } from './file-inventory.ts';

export type AgentAssetType = 'agent' | 'mcp_server' | 'cli_tool' | 'integration' | 'agent_config';
export type AgentAccessMode = 'read' | 'write' | 'execute' | 'admin' | 'unknown';

export interface DiscoveredCapability {
  capability: string;
  accessMode: AgentAccessMode;
  targetType: string;
  targetIdentifier: string;
  evidenceHash: string;
}

export interface DiscoveredAgentAsset {
  discoveryKey: string;
  assetType: AgentAssetType;
  name: string;
  vendor: string;
  version: string;
  sourceIdentifier: string;
  evidenceHash: string;
  metadata: Record<string, unknown>;
  capabilities: DiscoveredCapability[];
}

export interface DiscoveredAgentRelationship {
  fromDiscoveryKey: string;
  relationType: 'USES' | 'EXPOSES' | 'CAN_ACCESS' | 'READS_FROM' | 'WRITES_TO' | 'CONFIGURES';
  toDiscoveryKey?: string;
  targetType: string;
  targetIdentifier: string;
  evidenceHash: string;
}

export interface AgentConfigDiscovery {
  assets: DiscoveredAgentAsset[];
  relationships: DiscoveredAgentRelationship[];
  limitations: string[];
}

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_CONFIG_FILES = 200;
const AGENT_CONFIG_PATHS = [
  /(^|\/)\.claude\/settings(?:\.local)?\.json$/i,
  /(^|\/)\.cursor\/settings\.json$/i,
  /(^|\/)\.cursor\/mcp\.json$/i,
  /(^|\/)\.mcp\.json$/i,
  /(^|\/)mcp\.json$/i,
  /(^|\/)\.vscode\/tasks\.json$/i,
];

function hash(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanString(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function executableName(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return 'unknown';
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  return unquoted.split(/[\\/]/).pop()?.slice(0, 120) || 'unknown';
}

function envKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, 100).sort();
}

function configKind(path: string): { name: string; vendor: string } {
  if (/\.claude\//i.test(path)) return { name: 'Claude configuration', vendor: 'Anthropic' };
  if (/\.cursor\//i.test(path)) return { name: 'Cursor configuration', vendor: 'Cursor' };
  if (/\.vscode\//i.test(path)) return { name: 'VS Code task configuration', vendor: 'Microsoft' };
  return { name: 'MCP configuration', vendor: '' };
}

function mcpServers(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const root = parsed as Record<string, unknown>;
  const direct = root.mcpServers;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, unknown>;
  const nested = root.mcp;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const servers = (nested as Record<string, unknown>).servers;
    if (servers && typeof servers === 'object' && !Array.isArray(servers)) return servers as Record<string, unknown>;
  }
  return {};
}

function taskCommands(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const tasks = (parsed as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((task) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return [];
    const command = cleanString((task as Record<string, unknown>).command, 500);
    return command ? [command] : [];
  }).slice(0, 100);
}

function commandLooksAgentRelated(command: string): boolean {
  return /\b(claude|cursor|codex|copilot|gemini|mcp|agent)\b/i.test(command);
}

export async function discoverAgentConfigEvidence(
  entries: InventoryEntry[],
  source: { repository: string; commitSha: string },
): Promise<AgentConfigDiscovery> {
  const assets: DiscoveredAgentAsset[] = [];
  const relationships: DiscoveredAgentRelationship[] = [];
  const limitations: string[] = [];
  const candidates = entries.filter((entry) => entry.absolutePath && AGENT_CONFIG_PATHS.some((pattern) => pattern.test(entry.path)));
  if (candidates.length > MAX_CONFIG_FILES) limitations.push(`AGENT_CONFIG_DISCOVERY_TRUNCATED: found ${candidates.length} candidate files; inspected first ${MAX_CONFIG_FILES}.`);

  for (const entry of candidates.slice(0, MAX_CONFIG_FILES)) {
    if (!entry.absolutePath) continue;
    if (entry.size !== null && entry.size > MAX_CONFIG_BYTES) {
      limitations.push(`AGENT_CONFIG_TOO_LARGE: ${entry.path} exceeds ${MAX_CONFIG_BYTES} bytes and was not parsed.`);
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(entry.absolutePath);
    } catch {
      limitations.push(`AGENT_CONFIG_UNREADABLE: ${entry.path} could not be read.`);
      continue;
    }
    if (bytes.length > MAX_CONFIG_BYTES) {
      limitations.push(`AGENT_CONFIG_TOO_LARGE: ${entry.path} exceeds ${MAX_CONFIG_BYTES} bytes and was not parsed.`);
      continue;
    }

    const evidenceHash = hash(bytes);
    const sourceIdentifier = `github:${source.repository}@${source.commitSha}:${entry.path}`;
    const configKey = `config:${entry.path}`;
    const kind = configKind(entry.path);
    let parsed: unknown = null;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch {
      limitations.push(`AGENT_CONFIG_INVALID_JSON: ${entry.path} was observed and hashed but could not be structurally parsed.`);
    }

    const servers = mcpServers(parsed);
    const commands = taskCommands(parsed);
    const hooksPresent = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Record<string, unknown>).hooks);
    const capabilities: DiscoveredCapability[] = commands
      .filter(commandLooksAgentRelated)
      .map((command) => ({
        capability: 'process.execute',
        accessMode: 'execute' as const,
        targetType: 'executable',
        targetIdentifier: executableName(command),
        evidenceHash,
      }));

    assets.push({
      discoveryKey: configKey,
      assetType: 'agent_config',
      name: kind.name,
      vendor: kind.vendor,
      version: '',
      sourceIdentifier,
      evidenceHash,
      metadata: {
        repository: source.repository,
        commitSha: source.commitSha,
        path: entry.path,
        mcpServerNames: Object.keys(servers).slice(0, 100).sort(),
        agentRelatedTaskExecutables: commands.filter(commandLooksAgentRelated).map(executableName),
        hooksPresent,
      },
      capabilities,
    });

    for (const [serverName, raw] of Object.entries(servers).slice(0, 100)) {
      const server = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const command = cleanString(server.command, 500);
      const url = cleanString(server.url, 500);
      const serverHash = hash(JSON.stringify({ serverName, command, url, args: Array.isArray(server.args) ? server.args : [], envKeys: envKeys(server.env) }));
      const serverKey = `mcp:${entry.path}:${serverName}`;
      const serverCapabilities: DiscoveredCapability[] = [];
      if (command) serverCapabilities.push({ capability: 'process.execute', accessMode: 'execute', targetType: 'executable', targetIdentifier: executableName(command), evidenceHash: serverHash });
      if (url) serverCapabilities.push({ capability: 'network.connect', accessMode: 'execute', targetType: 'endpoint', targetIdentifier: url, evidenceHash: serverHash });

      assets.push({
        discoveryKey: serverKey,
        assetType: 'mcp_server',
        name: serverName.slice(0, 255),
        vendor: '',
        version: '',
        sourceIdentifier: `${sourceIdentifier}#mcp:${serverName}`,
        evidenceHash: serverHash,
        metadata: {
          repository: source.repository,
          commitSha: source.commitSha,
          configuredIn: entry.path,
          transport: url ? 'remote' : command ? 'local_process' : 'unknown',
          commandExecutable: command ? executableName(command) : '',
          endpoint: url,
          envKeys: envKeys(server.env),
        },
        capabilities: serverCapabilities,
      });
      relationships.push({
        fromDiscoveryKey: configKey,
        relationType: 'CONFIGURES',
        toDiscoveryKey: serverKey,
        targetType: 'mcp_server',
        targetIdentifier: serverName.slice(0, 255),
        evidenceHash: serverHash,
      });
    }
  }

  return { assets, relationships, limitations };
}
