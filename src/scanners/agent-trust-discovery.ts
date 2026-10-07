import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { collectFiles } from './real-repository-scanners.ts';

type DiscoveryContext = {
  tenantId: string;
  passportId: string;
  scanId: string | null;
  root: string;
  sourceRef: string;
};

type DiscoveredAgent = {
  id: string;
  name: string;
  agentType: 'mcp_client' | 'coding_agent' | 'assistant' | 'unknown';
  provider: string | null;
  modelFamily: string | null;
  modelVersion: string | null;
  source: string;
  sourceRef: string;
  observationState: 'OBSERVED' | 'PARTIAL';
};

type DiscoveredMcpServer = {
  id: string;
  agentId: string;
  name: string;
  transport: string | null;
  command: string | null;
  endpoint: string | null;
  packageName: string | null;
  packageVersion: string | null;
  configPath: string;
  envKeys: string[];
};

type DiscoveredCapability = {
  id: string;
  agentId: string;
  capability: string;
  observationState: 'DECLARED' | 'INFERRED';
  detail: string;
};

type DiscoveredBoundary = {
  id: string;
  sourceAssetId: string | null;
  destinationAssetId: string | null;
  boundaryType: string;
  transport: string | null;
  contentType: string | null;
  state: 'UNKNOWN' | 'UNVERIFIED';
  verificationPresent: boolean | null;
};

function sha(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function stableId(prefix: string, value: string) {
  return `${prefix}_${sha(value).slice(0, 32)}`;
}
function normalized(relativePath: string) {
  return relativePath.replaceAll('\\', '/');
}
function safeString(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function packageFromCommand(command: string | null, args: unknown): { name: string | null; version: string | null } {
  const list = Array.isArray(args) ? args.filter((x) => typeof x === 'string') as string[] : [];
  const token = list.find((x) => /^@?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?(?:@[0-9][^\s]*)?$/.test(x));
  if (!token) return { name: command && /^(?:npx|pnpm|yarn|bunx)$/.test(command) ? null : command, version: null };
  const scoped = token.startsWith('@');
  const cut = scoped ? token.indexOf('@', 1) : token.lastIndexOf('@');
  if (cut > 0) return { name: token.slice(0, cut), version: token.slice(cut + 1) || null };
  return { name: token, version: null };
}
function detectProvider(text: string): { provider: string | null; modelFamily: string | null } {
  const pairs: Array<[RegExp,string,string]> = [
    [/@anthropic-ai\/sdk|\bAnthropic\b/i, 'Anthropic', 'Claude'],
    [/\bopenai\b|from ['"]openai['"]/i, 'OpenAI', 'OpenAI'],
    [/@google\/genai|GoogleGenAI|Gemini/i, 'Google', 'Gemini'],
    [/\bbedrock\b|@aws-sdk\/client-bedrock/i, 'AWS', 'Bedrock'],
  ];
  for (const [pattern, provider, family] of pairs) if (pattern.test(text)) return { provider, modelFamily: family };
  return { provider: null, modelFamily: null };
}
function isMcpConfigPath(p: string) {
  const n = normalized(p).toLowerCase();
  return n.endsWith('/mcp.json') || n === 'mcp.json' || n === '.mcp.json' ||
    n.endsWith('/.mcp.json') || n.endsWith('/claude_desktop_config.json') ||
    n.endsWith('/claude.json') || n.endsWith('/mcp_config.json');
}

export async function discoverAgentTrust(root: string) {
  const { files } = await collectFiles(root);
  const agents = new Map<string, DiscoveredAgent>();
  const servers = new Map<string, DiscoveredMcpServer>();
  const capabilities = new Map<string, DiscoveredCapability>();
  const boundaries = new Map<string, DiscoveredBoundary>();
  const evidenceSources: Array<{ path: string; hash: string; kind: string; serverNames?: string[]; envKeys?: string[] }> = [];

  for (const file of files) {
    const rel = normalized(file.relativePath);
    if (file.size > 1024 * 1024) continue;
    const candidate = isMcpConfigPath(rel) || /(?:^|\/)(?:package\.json|pyproject\.toml|requirements\.txt|\.cursor\/.*|\.claude\/.*)$/i.test(rel) || /\.[cm]?[jt]sx?$/.test(rel);
    if (!candidate) continue;

    let text = '';
    try { text = await readFile(file.absolutePath, 'utf8'); } catch { continue; }
    const fileHash = `sha256:${sha(text)}`;
    const provider = detectProvider(text);

    if (isMcpConfigPath(rel)) {
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const mcpServers = parsed && typeof parsed === 'object' ? (parsed.mcpServers ?? parsed.servers ?? null) : null;
      if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
        const clientId = stableId('agent', `${rel}|mcp-client`);
        agents.set(clientId, {
          id: clientId,
          name: `MCP client configuration (${path.posix.basename(rel)})`,
          agentType: 'mcp_client',
          provider: provider.provider,
          modelFamily: provider.modelFamily,
          modelVersion: null,
          source: 'repository-config',
          sourceRef: rel,
          observationState: 'OBSERVED',
        });
        const observedEnvKeys = new Set<string>();
        const names: string[] = [];
        for (const [serverName, raw] of Object.entries(mcpServers as Record<string, any>)) {
          if (!raw || typeof raw !== 'object') continue;
          names.push(serverName);
          const command = safeString(raw.command, 255);
          const endpoint = safeString(raw.url ?? raw.endpoint, 1000);
          const args = Array.isArray(raw.args) ? raw.args : [];
          const pkg = packageFromCommand(command, args);
          const envKeys = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
            ? Object.keys(raw.env).map((x) => x.slice(0, 255)).sort()
            : [];
          envKeys.forEach((k) => observedEnvKeys.add(k));
          const serverId = stableId('mcp', `${rel}|${serverName}`);
          servers.set(serverId, {
            id: serverId,
            agentId: clientId,
            name: serverName.slice(0, 255),
            transport: endpoint ? 'http' : command ? 'stdio' : null,
            command,
            endpoint,
            packageName: pkg.name,
            packageVersion: pkg.version,
            configPath: rel,
            envKeys,
          });
          if (command) {
            const id = stableId('cap', `${clientId}|shell_execution|${serverName}`);
            capabilities.set(id, { id, agentId: clientId, capability: 'shell_execution', observationState: 'DECLARED', detail: `MCP server ${serverName} declares a local command.` });
          }
          if (endpoint) {
            const id = stableId('cap', `${clientId}|network_egress|${serverName}`);
            capabilities.set(id, { id, agentId: clientId, capability: 'network_egress', observationState: 'DECLARED', detail: `MCP server ${serverName} declares a remote endpoint.` });
          }
          if (envKeys.length) {
            const id = stableId('cap', `${clientId}|secret_or_config_input|${serverName}`);
            capabilities.set(id, { id, agentId: clientId, capability: 'secret_or_config_input', observationState: 'INFERRED', detail: `MCP server ${serverName} declares environment keys; values are intentionally not persisted.` });
          }
          const boundaryId = stableId('boundary', `${serverId}|${clientId}|mcp_tool_response_to_agent`);
          boundaries.set(boundaryId, {
            id: boundaryId,
            sourceAssetId: serverId,
            destinationAssetId: clientId,
            boundaryType: 'mcp_tool_response_to_agent',
            transport: endpoint ? 'http' : command ? 'stdio' : null,
            contentType: 'tool_result',
            state: 'UNKNOWN',
            verificationPresent: null,
          });
        }
        evidenceSources.push({ path: rel, hash: fileHash, kind: 'mcp-config', serverNames: names.sort(), envKeys: [...observedEnvKeys].sort() });
      }
    }

    if (provider.provider) {
      const id = stableId('agent', `${rel}|${provider.provider}|${provider.modelFamily}`);
      if (!agents.has(id)) agents.set(id, {
        id,
        name: `AI integration observed in ${rel}`,
        agentType: /agent|worker|orchestrator/i.test(text) ? 'unknown' : 'assistant',
        provider: provider.provider,
        modelFamily: provider.modelFamily,
        modelVersion: null,
        source: 'repository-source',
        sourceRef: rel,
        observationState: 'PARTIAL',
      });
      evidenceSources.push({ path: rel, hash: fileHash, kind: 'ai-provider-reference' });
    }
  }

  const payload = {
    agents: [...agents.values()].sort((a,b) => a.id.localeCompare(b.id)),
    mcpServers: [...servers.values()].sort((a,b) => a.id.localeCompare(b.id)),
    capabilities: [...capabilities.values()].sort((a,b) => a.id.localeCompare(b.id)),
    boundaries: [...boundaries.values()].sort((a,b) => a.id.localeCompare(b.id)),
    evidenceSources: evidenceSources.sort((a,b) => a.path.localeCompare(b.path)),
  };
  return { ...payload, snapshotHash: `sha256:${sha(JSON.stringify(payload))}` };
}

function diffById<T extends { id: string }>(before: T[], after: T[], type: string) {
  const a = new Map(before.map((x) => [x.id, x]));
  const b = new Map(after.map((x) => [x.id, x]));
  const changes: Array<{ changeType: string; subject: string; before: unknown; after: unknown }> = [];
  for (const [id, value] of b) {
    if (!a.has(id)) changes.push({ changeType: `${type}_ADDED`, subject: id, before: null, after: value });
    else if (JSON.stringify(a.get(id)) !== JSON.stringify(value)) changes.push({ changeType: `${type}_CHANGED`, subject: id, before: a.get(id), after: value });
  }
  for (const [id, value] of a) if (!b.has(id)) changes.push({ changeType: `${type}_NOT_OBSERVED`, subject: id, before: value, after: null });
  return changes;
}

export async function discoverAndPersistAgentTrust(pool: Pool, context: DiscoveryContext) {
  const discovered = await discoverAgentTrust(context.root);
  const now = new Date().toISOString();

  const previous = (await pool.query(
    `SELECT id, payload, snapshot_hash FROM agent_trust_snapshots WHERE tenant_id=$1 AND passport_id=$2 ORDER BY observed_at DESC LIMIT 1`,
    [context.tenantId, context.passportId],
  )).rows[0] ?? null;

  for (const agent of discovered.agents) {
    await pool.query(
      `INSERT INTO agent_assets (id,tenant_id,passport_id,name,agent_type,provider,model_family,model_version,runtime,environment,source,source_ref,observation_state,first_observed_at,last_observed_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,$10,$11,$12,$12,$12,$12)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,agent_type=EXCLUDED.agent_type,provider=EXCLUDED.provider,model_family=EXCLUDED.model_family,model_version=EXCLUDED.model_version,source=EXCLUDED.source,source_ref=EXCLUDED.source_ref,observation_state=EXCLUDED.observation_state,last_observed_at=EXCLUDED.last_observed_at,updated_at=EXCLUDED.updated_at
       WHERE agent_assets.tenant_id=$2 AND agent_assets.passport_id=$3`,
      [agent.id,context.tenantId,context.passportId,agent.name,agent.agentType,agent.provider,agent.modelFamily,agent.modelVersion,agent.source,agent.sourceRef,agent.observationState,now],
    );
  }

  const currentAgentIds = discovered.agents.map((x) => x.id);
  if (currentAgentIds.length) {
    await pool.query(
      `UPDATE agent_assets SET observation_state='UNOBSERVED',updated_at=$3 WHERE tenant_id=$1 AND passport_id=$2 AND source LIKE 'repository-%' AND NOT (id = ANY($4::text[]))`,
      [context.tenantId,context.passportId,now,currentAgentIds],
    );
  } else {
    await pool.query(
      `UPDATE agent_assets SET observation_state='UNOBSERVED',updated_at=$3 WHERE tenant_id=$1 AND passport_id=$2 AND source LIKE 'repository-%'`,
      [context.tenantId,context.passportId,now],
    );
  }

  for (const server of discovered.mcpServers) {
    await pool.query(
      `INSERT INTO agent_mcp_servers (id,tenant_id,passport_id,agent_asset_id,server_name,server_version,transport,command,endpoint,package_name,package_version,source_repository,integrity_hash,authentication_type,network_access,filesystem_access,secret_access,installation_source,configuration_source,observed_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,NULL,NULL,NULL,$11,NULL,$12,'repository-config',$13,$14)
       ON CONFLICT (id) DO UPDATE SET agent_asset_id=EXCLUDED.agent_asset_id,server_name=EXCLUDED.server_name,transport=EXCLUDED.transport,command=EXCLUDED.command,endpoint=EXCLUDED.endpoint,package_name=EXCLUDED.package_name,package_version=EXCLUDED.package_version,network_access=EXCLUDED.network_access,secret_access=EXCLUDED.secret_access,configuration_source=EXCLUDED.configuration_source,observed_at=EXCLUDED.observed_at
       WHERE agent_mcp_servers.tenant_id=$2 AND agent_mcp_servers.passport_id=$3`,
      [server.id,context.tenantId,context.passportId,server.agentId,server.name,server.transport,server.command,server.endpoint,server.packageName,server.packageVersion,server.endpoint ? 'declared' : null,server.envKeys.length ? 'environment-key-names-declared' : null,server.configPath,now],
    );
  }

  for (const cap of discovered.capabilities) {
    await pool.query(
      `INSERT INTO agent_capabilities (id,tenant_id,passport_id,agent_asset_id,capability,observation_state,evidence_id,detail,observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)
       ON CONFLICT (id) DO UPDATE SET observation_state=EXCLUDED.observation_state,detail=EXCLUDED.detail,observed_at=EXCLUDED.observed_at
       WHERE agent_capabilities.tenant_id=$2 AND agent_capabilities.passport_id=$3`,
      [cap.id,context.tenantId,context.passportId,cap.agentId,cap.capability,cap.observationState,cap.detail,now],
    );
  }

  for (const boundary of discovered.boundaries) {
    await pool.query(
      `INSERT INTO agent_trust_boundaries (id,tenant_id,passport_id,source_asset_id,destination_asset_id,boundary_type,transport,direction,content_type,authorization_required,verification_present,verification_method,evidence_id,state,first_observed_at,last_observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'inbound',$8,NULL,$9,NULL,NULL,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET transport=EXCLUDED.transport,content_type=EXCLUDED.content_type,verification_present=EXCLUDED.verification_present,state=EXCLUDED.state,last_observed_at=EXCLUDED.last_observed_at
       WHERE agent_trust_boundaries.tenant_id=$2 AND agent_trust_boundaries.passport_id=$3`,
      [boundary.id,context.tenantId,context.passportId,boundary.sourceAssetId,boundary.destinationAssetId,boundary.boundaryType,boundary.transport,boundary.contentType,boundary.verificationPresent,boundary.state,now],
    );
  }

  const snapshotId = stableId('agentsnap', `${context.passportId}|${context.sourceRef}|${discovered.snapshotHash}`);
  await pool.query(
    `INSERT INTO agent_trust_snapshots (id,tenant_id,passport_id,scan_id,source_ref,snapshot_hash,payload,observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING`,
    [snapshotId,context.tenantId,context.passportId,context.scanId,context.sourceRef,discovered.snapshotHash,JSON.stringify(discovered),now],
  );

  const changes = previous && previous.snapshot_hash !== discovered.snapshotHash
    ? [
        ...diffById(previous.payload?.agents ?? [], discovered.agents, 'AGENT'),
        ...diffById(previous.payload?.mcpServers ?? [], discovered.mcpServers, 'MCP_SERVER'),
        ...diffById(previous.payload?.capabilities ?? [], discovered.capabilities, 'CAPABILITY'),
        ...diffById(previous.payload?.boundaries ?? [], discovered.boundaries, 'BOUNDARY'),
      ]
    : [];

  for (const change of changes) {
    const changeId = stableId('agentchg', `${snapshotId}|${change.changeType}|${change.subject}`);
    await pool.query(
      `INSERT INTO agent_trust_changes (id,tenant_id,passport_id,scan_id,previous_snapshot_id,current_snapshot_id,change_type,subject,before_state,after_state,observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) ON CONFLICT (id) DO NOTHING`,
      [changeId,context.tenantId,context.passportId,context.scanId,previous.id,snapshotId,change.changeType,change.subject,JSON.stringify(change.before),JSON.stringify(change.after),now],
    );
  }

  if (discovered.evidenceSources.length) {
    const evidenceId = stableId('ev-agent', `${context.passportId}|${context.sourceRef}|${discovered.snapshotHash}`);
    const safePayload = {
      sourceRef: context.sourceRef,
      snapshotHash: discovered.snapshotHash,
      agentCount: discovered.agents.length,
      mcpServerCount: discovered.mcpServers.length,
      capabilityCount: discovered.capabilities.length,
      boundaryCount: discovered.boundaries.length,
      sources: discovered.evidenceSources,
      note: 'Configuration hashes, paths, server names and environment key names only. Secret/config values are intentionally not persisted.',
    };
    await pool.query(
      `INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,status,signer,timestamp,hash,raw_content,engine_id,verification_failure_reason,scan_id)
       VALUES ($1,$2,$3,'AI/agent configuration discovery','Attestation',0,'OBSERVED','spr-agent-trust-discovery',$4,$5,$6,'agent-trust-discovery',NULL,$7)
       ON CONFLICT (id) DO NOTHING`,
      [evidenceId,context.tenantId,context.passportId,now,discovered.snapshotHash,JSON.stringify(safePayload),context.scanId],
    );
  }

  return {
    snapshotId,
    snapshotHash: discovered.snapshotHash,
    agentCount: discovered.agents.length,
    mcpServerCount: discovered.mcpServers.length,
    capabilityCount: discovered.capabilities.length,
    boundaryCount: discovered.boundaries.length,
    changeCount: changes.length,
  };
}
