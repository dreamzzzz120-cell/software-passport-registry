import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AgentConfigDiscovery, DiscoveredAgentAsset } from './agent-config-discovery.ts';

function id(prefix: string) {
  return \`\${prefix}_\${crypto.randomUUID().replaceAll('-', '')}\`;
}

async function upsertAsset(
  client: PoolClient,
  tenantId: string,
  passportId: string | null,
  observedAt: string,
  asset: DiscoveredAgentAsset,
): Promise<{ assetId: string; previousHash: string | null }> {
  const existing = (await client.query(
    \`SELECT id, evidence_hash FROM agent_assets WHERE tenant_id=$1 AND source_type='github' AND source_identifier=$2 LIMIT 1\`,
    [tenantId, asset.sourceIdentifier],
  )).rows[0] as { id?: string; evidence_hash?: string } | undefined;
  const assetId = existing?.id || id('aasset');

  await client.query(
    \`INSERT INTO agent_assets (
       id,tenant_id,passport_id,asset_type,name,vendor,version,source_type,source_identifier,
       origin_trust,verification_state,evidence_hash,metadata,first_seen_at,last_seen_at,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'github',$8,'UNKNOWN','OBSERVED',$9,$10::jsonb,$11,$11,NOW(),NOW())
     ON CONFLICT (tenant_id,source_type,source_identifier)
     DO UPDATE SET
       passport_id=EXCLUDED.passport_id,
       asset_type=EXCLUDED.asset_type,
       name=EXCLUDED.name,
       vendor=EXCLUDED.vendor,
       version=EXCLUDED.version,
       origin_trust='UNKNOWN',
       verification_state='OBSERVED',
       evidence_hash=EXCLUDED.evidence_hash,
       metadata=EXCLUDED.metadata,
       last_seen_at=GREATEST(agent_assets.last_seen_at,EXCLUDED.last_seen_at),
       updated_at=NOW()\`,
    [assetId, tenantId, passportId, asset.assetType, asset.name, asset.vendor, asset.version, asset.sourceIdentifier, asset.evidenceHash, JSON.stringify(asset.metadata), observedAt],
  );

  await client.query('DELETE FROM agent_capabilities WHERE tenant_id=$1 AND agent_asset_id=$2', [tenantId, assetId]);
  for (const capability of asset.capabilities) {
    await client.query(
      \`INSERT INTO agent_capabilities (
         id,tenant_id,agent_asset_id,capability,access_mode,target_type,target_identifier,observed_at,evidence_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)\`,
      [id('acap'), tenantId, assetId, capability.capability, capability.accessMode, capability.targetType, capability.targetIdentifier, observedAt, capability.evidenceHash],
    );
  }
  return { assetId, previousHash: existing?.evidence_hash || null };
}

export async function persistAgentConfigDiscovery(
  pool: Pool,
  context: { tenantId: string; passportId: string | null; repository: string; commitSha: string; observedAt?: string },
  discovery: AgentConfigDiscovery,
): Promise<{ assets: number; relationships: number; driftEvents: number }> {
  if (!discovery.assets.length) return { assets: 0, relationships: 0, driftEvents: 0 };
  const client = await pool.connect();
  const observedAt = context.observedAt || new Date().toISOString();
  try {
    await client.query('BEGIN');
    await client.query(\`SELECT set_config('app.tenant_id', $1, true)\`, [context.tenantId]);

    const ids = new Map<string, string>();
    let driftEvents = 0;
    for (const asset of discovery.assets) {
      const persisted = await upsertAsset(client, context.tenantId, context.passportId, observedAt, asset);
      ids.set(asset.discoveryKey, persisted.assetId);

      if (asset.assetType === 'agent_config' && persisted.previousHash && persisted.previousHash !== asset.evidenceHash) {
        await client.query(
          \`INSERT INTO agent_security_events (
             id,tenant_id,agent_asset_id,event_type,source_origin,source_ref,action_capability,target_ref,
             outcome,severity,evidence_ids,detail,observed_at,created_at
           ) VALUES (
             $1,$2,$3,'agent_config_drift','UNKNOWN',$4,'','',
             'NOT_OBSERVED','medium','[]'::jsonb,$5::jsonb,$6,NOW()
           )\`,
          [
            id('asevt'),
            context.tenantId,
            persisted.assetId,
            asset.sourceIdentifier,
            JSON.stringify({
              repository: context.repository,
              commitSha: context.commitSha,
              previousEvidenceHash: persisted.previousHash,
              currentEvidenceHash: asset.evidenceHash,
            }),
            observedAt,
          ],
        );
        driftEvents += 1;
      }
    }

    const fromAssetIds = [...new Set(discovery.relationships.map((relationship) => ids.get(relationship.fromDiscoveryKey)).filter(Boolean))] as string[];
    for (const fromId of fromAssetIds) {
      await client.query('DELETE FROM agent_relationships WHERE tenant_id=$1 AND from_asset_id=$2', [context.tenantId, fromId]);
    }

    let relationships = 0;
    for (const relationship of discovery.relationships) {
      const fromId = ids.get(relationship.fromDiscoveryKey);
      const toId = relationship.toDiscoveryKey ? ids.get(relationship.toDiscoveryKey) : undefined;
      if (!fromId || (relationship.toDiscoveryKey && !toId)) continue;
      await client.query(
        \`INSERT INTO agent_relationships (
           id,tenant_id,from_asset_id,relation_type,to_asset_id,target_type,target_identifier,observed_at,evidence_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)\`,
        [id('arel'), context.tenantId, fromId, relationship.relationType, toId || null, relationship.targetType, relationship.targetIdentifier, observedAt, relationship.evidenceHash],
      );
      relationships += 1;
    }

    await client.query('COMMIT');
    return { assets: discovery.assets.length, relationships, driftEvents };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
