import { Router } from 'express';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

const ASSET_TYPES = ['agent','mcp_server','cli_tool','integration','agent_config'] as const;
const SOURCE_TYPES = ['filesystem','github','mcp','cli','saas','manual_observation','other'] as const;
const ORIGINS = ['INTERNAL','EXTERNAL','UNKNOWN'] as const;
const VERIFICATION = ['OBSERVED','VERIFIED','UNKNOWN'] as const;
const INGEST_VERIFICATION = ['OBSERVED','UNKNOWN'] as const;
const ACCESS_MODES = ['read','write','execute','admin','unknown'] as const;
const EVENT_TYPES = ['prompt_injection_indicator','agent_config_drift','excessive_tool_scope','unverified_mcp','dangerous_tool_chain','execution_receipt'] as const;
const OUTCOMES = ['BLOCKED','SUCCEEDED','FAILED','NOT_OBSERVED','UNKNOWN'] as const;
const SEVERITIES = ['informational','low','medium','high','critical'] as const;

const capabilitySchema = z.object({
  capability: z.string().trim().min(1).max(160),
  accessMode: z.enum(ACCESS_MODES),
  targetType: z.string().trim().max(120).default('unknown'),
  targetIdentifier: z.string().trim().max(500).default(''),
  evidenceHash: z.string().trim().min(16).max(256),
}).strict();

const observeAssetSchema = z.object({
  aiSystemId: z.string().trim().max(255).nullable().optional(),
  passportId: z.string().trim().max(255).nullable().optional(),
  assetType: z.enum(ASSET_TYPES),
  name: z.string().trim().min(1).max(255),
  vendor: z.string().trim().max(255).default(''),
  version: z.string().trim().max(160).default(''),
  sourceType: z.enum(SOURCE_TYPES),
  sourceIdentifier: z.string().trim().min(1).max(1000),
  originTrust: z.enum(ORIGINS).default('UNKNOWN'),
  // VERIFIED is deliberately excluded from ingestion: collectors may observe evidence,
  // but verification must be earned by a separate verifier/proof path.
  verificationState: z.enum(INGEST_VERIFICATION).default('OBSERVED'),
  evidenceHash: z.string().trim().min(16).max(256),
  observedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  capabilities: z.array(capabilitySchema).max(200).default([]),
}).strict();

const relationshipSchema = z.object({
  fromAssetId: z.string().trim().min(1).max(255),
  relationType: z.enum(['USES','EXPOSES','CAN_ACCESS','READS_FROM','WRITES_TO','CONFIGURES']),
  toAssetId: z.string().trim().max(255).nullable().optional(),
  targetType: z.string().trim().max(120).default(''),
  targetIdentifier: z.string().trim().max(1000).default(''),
  evidenceHash: z.string().trim().min(16).max(256),
  observedAt: z.string().datetime(),
}).strict();

const eventSchema = z.object({
  agentAssetId: z.string().trim().max(255).nullable().optional(),
  eventType: z.enum(EVENT_TYPES),
  sourceOrigin: z.enum(ORIGINS).default('UNKNOWN'),
  sourceRef: z.string().trim().max(1000).default(''),
  actionCapability: z.string().trim().max(200).default(''),
  targetRef: z.string().trim().max(1000).default(''),
  outcome: z.enum(OUTCOMES).default('UNKNOWN'),
  severity: z.enum(SEVERITIES).default('informational'),
  evidenceIds: z.array(z.string().trim().min(1).max(255)).max(200).default([]),
  detail: z.record(z.string(), z.unknown()).default({}),
  observedAt: z.string().datetime(),
}).strict();

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

const SECRET_KEY_PATTERN = /(^|[_-])(secret|token|password|passwd|api[_-]?key|private[_-]?key|authorization|cookie|credential)s?($|[_-])/i;
const MAX_STRUCTURED_EVIDENCE_BYTES = 32 * 1024;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function structuredEvidenceIssue(value: Record<string, unknown>): string | null {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_STRUCTURED_EVIDENCE_BYTES) return 'structured evidence exceeds 32 KiB';
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key) && child !== null && child !== '' && child !== '[REDACTED]') {
        return `credential-like field "${key}" must be redacted before ingestion`;
      }
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

function validateObservedAt(value: string): boolean {
  const ts = Date.parse(value);
  return Number.isFinite(ts) && ts <= Date.now() + MAX_FUTURE_SKEW_MS;
}

const READ_ROLES = ['Owner','Admin','Operator'] as const;

export function createAgentSecurityRouter() {
  const router = Router();

  router.get('/summary', requireRole([...READ_ROLES]), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const [assetsResult, eventResult] = await Promise.all([
        db.execute(sql`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE asset_type='agent')::int AS agents,
            count(*) FILTER (WHERE asset_type='mcp_server')::int AS "mcpServers",
            count(*) FILTER (WHERE asset_type='mcp_server' AND verification_state<>'VERIFIED')::int AS "unverifiedMcp",
            count(*) FILTER (WHERE asset_type='agent_config')::int AS "agentConfigs"
          FROM agent_assets
          WHERE tenant_id=${tenantId}
        `),
        db.execute(sql`
          SELECT
            count(*) FILTER (WHERE event_type='agent_config_drift' AND observed_at >= now() - interval '30 days')::int AS "configDrift30d",
            count(*) FILTER (WHERE event_type='dangerous_tool_chain' AND observed_at >= now() - interval '30 days')::int AS "dangerousChains30d",
            count(*) FILTER (WHERE severity IN ('high','critical') AND outcome NOT IN ('BLOCKED','FAILED'))::int AS "openHighRiskSignals"
          FROM agent_security_events
          WHERE tenant_id=${tenantId}
        `),
      ]);
      const assets = (assetsResult as any).rows?.[0] || {};
      const events = (eventResult as any).rows?.[0] || {};
      return res.json({
        observed: true,
        authoritativeScope: 'Observed agent/MCP/config evidence only. Declared AI system fields remain separate.',
        ...assets,
        ...events,
      });
    } catch (error) { return next(error); }
  });

  router.get('/assets', requireRole([...READ_ROLES]), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const rows = (await req.db!.execute(sql`
        SELECT a.*,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'capability', c.capability,
              'accessMode', c.access_mode,
              'targetType', c.target_type,
              'targetIdentifier', c.target_identifier,
              'observedAt', c.observed_at,
              'evidenceHash', c.evidence_hash
            ) ORDER BY c.capability)
            FROM agent_capabilities c
            WHERE c.tenant_id=a.tenant_id AND c.agent_asset_id=a.id
          ), '[]'::jsonb) AS capabilities
        FROM agent_assets a
        WHERE a.tenant_id=${tenantId}
        ORDER BY a.last_seen_at DESC
        LIMIT 500
      `) as any).rows || [];
      return res.json({ assets: rows });
    } catch (error) { return next(error); }
  });

  router.post('/assets/observe', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = observeAssetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_AGENT_ASSET_OBSERVATION', details: parsed.error.flatten() });
    if (!validateObservedAt(parsed.data.observedAt)) return res.status(400).json({ error: 'INVALID_OBSERVED_AT', message: 'observedAt cannot be materially in the future.' });
    const metadataIssue = structuredEvidenceIssue(parsed.data.metadata);
    if (metadataIssue) return res.status(400).json({ error: 'UNSAFE_AGENT_METADATA', message: metadataIssue });
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const p = parsed.data;
      const existing = (await db.execute(sql`
        SELECT id FROM agent_assets
        WHERE tenant_id=${tenantId} AND source_type=${p.sourceType} AND source_identifier=${p.sourceIdentifier}
        LIMIT 1
      `) as any).rows?.[0];
      const assetId = existing?.id || makeId('aasset');
      await db.execute(sql`
        INSERT INTO agent_assets (
          id,tenant_id,ai_system_id,passport_id,asset_type,name,vendor,version,
          source_type,source_identifier,origin_trust,verification_state,evidence_hash,
          metadata,first_seen_at,last_seen_at,created_at,updated_at
        ) VALUES (
          ${assetId},${tenantId},${p.aiSystemId ?? null},${p.passportId ?? null},${p.assetType},${p.name},${p.vendor},${p.version},
          ${p.sourceType},${p.sourceIdentifier},${p.originTrust},${p.verificationState},${p.evidenceHash},
          CAST(${JSON.stringify(p.metadata)} AS jsonb),${p.observedAt},${p.observedAt},now(),now()
        )
        ON CONFLICT (tenant_id, source_type, source_identifier)
        DO UPDATE SET
          ai_system_id=EXCLUDED.ai_system_id,
          passport_id=EXCLUDED.passport_id,
          asset_type=EXCLUDED.asset_type,
          name=EXCLUDED.name,
          vendor=EXCLUDED.vendor,
          version=EXCLUDED.version,
          origin_trust=EXCLUDED.origin_trust,
          verification_state=EXCLUDED.verification_state,
          evidence_hash=EXCLUDED.evidence_hash,
          metadata=EXCLUDED.metadata,
          last_seen_at=GREATEST(agent_assets.last_seen_at, EXCLUDED.last_seen_at),
          updated_at=now()
      `);
      // Capabilities are a snapshot, not an append-only claim. Remove prior rows in the
      // same request-scoped transaction so revoked permissions do not remain visible.
      await db.execute(sql`DELETE FROM agent_capabilities WHERE tenant_id=${tenantId} AND agent_asset_id=${assetId}`);
      for (const c of p.capabilities) {
        await db.execute(sql`
          INSERT INTO agent_capabilities (
            id,tenant_id,agent_asset_id,capability,access_mode,target_type,target_identifier,observed_at,evidence_hash
          ) VALUES (
            ${makeId('acap')},${tenantId},${assetId},${c.capability},${c.accessMode},${c.targetType},${c.targetIdentifier},${p.observedAt},${c.evidenceHash}
          )
          ON CONFLICT (tenant_id, agent_asset_id, capability, target_type, target_identifier)
          DO UPDATE SET access_mode=EXCLUDED.access_mode, observed_at=EXCLUDED.observed_at, evidence_hash=EXCLUDED.evidence_hash
        `);
      }
      await appendAuditEntry(db, {
        tenantId,
        action: 'agent_asset.observed',
        actor: req.user!.email,
        payload: { assetId, assetType: p.assetType, sourceType: p.sourceType, sourceIdentifier: p.sourceIdentifier, verificationState: p.verificationState },
      });
      return res.status(existing ? 200 : 201).json({ id: assetId, status: existing ? 'updated' : 'created' });
    } catch (error) { return next(error); }
  });

  router.get('/relationships', requireRole([...READ_ROLES]), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const rows = (await req.db!.execute(sql`
        SELECT r.*
        FROM agent_relationships r
        WHERE r.tenant_id=${tenantId}
        ORDER BY r.observed_at DESC
        LIMIT 1000
      `) as any).rows || [];
      return res.json({ relationships: rows });
    } catch (error) { return next(error); }
  });

  router.post('/relationships', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = relationshipSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_AGENT_RELATIONSHIP', details: parsed.error.flatten() });
    if (!validateObservedAt(parsed.data.observedAt)) return res.status(400).json({ error: 'INVALID_OBSERVED_AT', message: 'observedAt cannot be materially in the future.' });
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const p = parsed.data;
      const fromOwner = (await db.execute(sql`SELECT id FROM agent_assets WHERE tenant_id=${tenantId} AND id=${p.fromAssetId} LIMIT 1`) as any).rows?.[0];
      if (!fromOwner) return res.status(404).json({ error: 'AGENT_ASSET_NOT_FOUND' });
      if (p.toAssetId) {
        const toOwner = (await db.execute(sql`SELECT id FROM agent_assets WHERE tenant_id=${tenantId} AND id=${p.toAssetId} LIMIT 1`) as any).rows?.[0];
        if (!toOwner) return res.status(404).json({ error: 'AGENT_ASSET_NOT_FOUND' });
      }
      const relationshipId = makeId('arel');
      await db.execute(sql`
        INSERT INTO agent_relationships (
          id,tenant_id,from_asset_id,relation_type,to_asset_id,target_type,target_identifier,observed_at,evidence_hash
        ) VALUES (
          ${relationshipId},${tenantId},${p.fromAssetId},${p.relationType},${p.toAssetId ?? null},${p.targetType},${p.targetIdentifier},${p.observedAt},${p.evidenceHash}
        )
      `);
      await appendAuditEntry(db, {
        tenantId,
        action: 'agent_relationship.observed',
        actor: req.user!.email,
        payload: { relationshipId, fromAssetId: p.fromAssetId, relationType: p.relationType, toAssetId: p.toAssetId ?? null, targetType: p.targetType, targetIdentifier: p.targetIdentifier },
      });
      return res.status(201).json({ id: relationshipId, ...p });
    } catch (error) { return next(error); }
  });

  router.get('/events', requireRole([...READ_ROLES]), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const rows = (await req.db!.execute(sql`
        SELECT *
        FROM agent_security_events
        WHERE tenant_id=${tenantId}
        ORDER BY observed_at DESC
        LIMIT 500
      `) as any).rows || [];
      return res.json({ events: rows });
    } catch (error) { return next(error); }
  });

  router.post('/events', requireRole(['Owner','Admin','Operator']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_AGENT_SECURITY_EVENT', details: parsed.error.flatten() });
    if (!validateObservedAt(parsed.data.observedAt)) return res.status(400).json({ error: 'INVALID_OBSERVED_AT', message: 'observedAt cannot be materially in the future.' });
    const detailIssue = structuredEvidenceIssue(parsed.data.detail);
    if (detailIssue) return res.status(400).json({ error: 'UNSAFE_EVENT_DETAIL', message: detailIssue });
    if (parsed.data.outcome === 'SUCCEEDED' && parsed.data.eventType !== 'execution_receipt') {
      return res.status(400).json({ error: 'UNPROVEN_EXECUTION_OUTCOME', message: 'SUCCEEDED may only be recorded on an execution_receipt event.' });
    }
    if (parsed.data.eventType === 'execution_receipt' && parsed.data.evidenceIds.length === 0) {
      return res.status(400).json({ error: 'EXECUTION_RECEIPT_EVIDENCE_REQUIRED', message: 'Execution receipts require at least one evidence reference.' });
    }
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const p = parsed.data;
      if (p.agentAssetId) {
        const owner = (await db.execute(sql`SELECT id FROM agent_assets WHERE id=${p.agentAssetId} AND tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0];
        if (!owner) return res.status(404).json({ error: 'AGENT_ASSET_NOT_FOUND' });
      }
      const eventId = makeId('asevt');
      await db.execute(sql`
        INSERT INTO agent_security_events (
          id,tenant_id,agent_asset_id,event_type,source_origin,source_ref,
          action_capability,target_ref,outcome,severity,evidence_ids,detail,observed_at
        ) VALUES (
          ${eventId},${tenantId},${p.agentAssetId ?? null},${p.eventType},${p.sourceOrigin},${p.sourceRef},
          ${p.actionCapability},${p.targetRef},${p.outcome},${p.severity},CAST(${JSON.stringify(p.evidenceIds)} AS jsonb),CAST(${JSON.stringify(p.detail)} AS jsonb),${p.observedAt}
        )
      `);
      await appendAuditEntry(db, {
        tenantId,
        action: 'agent_security.event_observed',
        actor: req.user!.email,
        payload: { eventId, eventType: p.eventType, outcome: p.outcome, severity: p.severity, evidenceIds: p.evidenceIds },
      });
      return res.status(201).json({ id: eventId, ...p });
    } catch (error) { return next(error); }
  });

  return router;
}
