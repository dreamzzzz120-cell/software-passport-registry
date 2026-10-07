BEGIN;

-- Agent/MCP evidence layer. This extends SPR's existing AI Trust Center without
-- turning it into a second product. Declared ai_systems remain self-reported;
-- these tables hold independently observed agent/tool/config evidence.
CREATE TABLE IF NOT EXISTS agent_assets (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  ai_system_id text,
  passport_id text,
  asset_type text NOT NULL CHECK (asset_type IN ('agent','mcp_server','cli_tool','integration','agent_config')),
  name text NOT NULL,
  vendor text NOT NULL DEFAULT '',
  version text NOT NULL DEFAULT '',
  source_type text NOT NULL CHECK (source_type IN ('filesystem','github','mcp','cli','saas','manual_observation','other')),
  source_identifier text NOT NULL,
  origin_trust text NOT NULL DEFAULT 'UNKNOWN' CHECK (origin_trust IN ('INTERNAL','EXTERNAL','UNKNOWN')),
  verification_state text NOT NULL DEFAULT 'OBSERVED' CHECK (verification_state IN ('OBSERVED','VERIFIED','UNKNOWN')),
  evidence_hash text NOT NULL,
  -- Never store raw credentials or attacker payload secrets here. Ingestion rejects credential-like fields.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_type, source_identifier)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_assets_tenant_id_unique ON agent_assets(tenant_id, id);
CREATE INDEX IF NOT EXISTS agent_assets_tenant_type_idx ON agent_assets(tenant_id, asset_type, verification_state);
CREATE INDEX IF NOT EXISTS agent_assets_tenant_seen_idx ON agent_assets(tenant_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_asset_id text NOT NULL,
  capability text NOT NULL,
  access_mode text NOT NULL CHECK (access_mode IN ('read','write','execute','admin','unknown')),
  target_type text NOT NULL DEFAULT 'unknown',
  target_identifier text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  evidence_hash text NOT NULL,
  UNIQUE (tenant_id, agent_asset_id, capability, target_type, target_identifier),
  FOREIGN KEY (tenant_id, agent_asset_id) REFERENCES agent_assets(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_capabilities_scope_idx ON agent_capabilities(tenant_id, agent_asset_id, access_mode);

CREATE TABLE IF NOT EXISTS agent_relationships (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  from_asset_id text NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('USES','EXPOSES','CAN_ACCESS','READS_FROM','WRITES_TO','CONFIGURES')),
  to_asset_id text,
  target_type text NOT NULL DEFAULT '',
  target_identifier text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  evidence_hash text NOT NULL,
  FOREIGN KEY (tenant_id, from_asset_id) REFERENCES agent_assets(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_relationships_scope_idx ON agent_relationships(tenant_id, from_asset_id, relation_type);

CREATE TABLE IF NOT EXISTS agent_security_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_asset_id text,
  event_type text NOT NULL CHECK (event_type IN ('prompt_injection_indicator','credential_exposure_indicator','exfiltration_indicator','tool_call_anomaly','response_integrity_failure','agent_config_drift','excessive_tool_scope','unverified_mcp','dangerous_tool_chain','execution_receipt')),
  source_origin text NOT NULL DEFAULT 'UNKNOWN' CHECK (source_origin IN ('INTERNAL','EXTERNAL','UNKNOWN')),
  source_ref text NOT NULL DEFAULT '',
  action_capability text NOT NULL DEFAULT '',
  target_ref text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT 'UNKNOWN' CHECK (outcome IN ('BLOCKED','SUCCEEDED','FAILED','NOT_OBSERVED','UNKNOWN')),
  severity text NOT NULL DEFAULT 'informational' CHECK (severity IN ('informational','low','medium','high','critical')),
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Structured observation only; raw credentials/tokens must be redacted before storage.
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_security_events_scope_idx ON agent_security_events(tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS agent_security_events_type_idx ON agent_security_events(tenant_id, event_type, severity);

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['agent_assets','agent_capabilities','agent_relationships','agent_security_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'spr_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_assets, agent_capabilities, agent_relationships, agent_security_events TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_assets, agent_capabilities, agent_relationships, agent_security_events TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
