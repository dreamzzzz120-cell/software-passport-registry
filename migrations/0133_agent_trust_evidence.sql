BEGIN;

-- Evidence-first AI/agent trust inventory. These records describe what SPR has
-- observed or what an operator has explicitly recorded. They never grant
-- authority and never assert that an agent/model is "safe" or "trusted".
CREATE TABLE IF NOT EXISTS agent_assets (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  name text NOT NULL,
  agent_type text NOT NULL CHECK (agent_type IN ('assistant','autonomous_agent','orchestrator','worker','mcp_client','mcp_server','tool_agent','coding_agent','unknown')),
  provider text,
  model_family text,
  model_version text,
  runtime text,
  environment text,
  source text NOT NULL,
  source_ref text,
  observation_state text NOT NULL CHECK (observation_state IN ('OBSERVED','PARTIAL','UNKNOWN','UNOBSERVED')),
  first_observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_assets_passport_idx ON agent_assets (tenant_id, passport_id, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_trust_boundaries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  source_asset_id text,
  destination_asset_id text,
  boundary_type text NOT NULL,
  transport text,
  direction text,
  content_type text,
  authorization_required boolean,
  verification_present boolean,
  verification_method text,
  evidence_id text,
  state text NOT NULL CHECK (state IN ('OBSERVED','VERIFIED','UNVERIFIED','UNKNOWN')),
  first_observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_trust_boundaries_passport_idx ON agent_trust_boundaries (tenant_id, passport_id, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  agent_asset_id text NOT NULL,
  capability text NOT NULL,
  observation_state text NOT NULL CHECK (observation_state IN ('DECLARED','OBSERVED','INFERRED','UNKNOWN')),
  evidence_id text,
  detail text,
  observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_capabilities_passport_idx ON agent_capabilities (tenant_id, passport_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_mcp_servers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  agent_asset_id text,
  server_name text NOT NULL,
  server_version text,
  transport text,
  command text,
  endpoint text,
  package_name text,
  package_version text,
  source_repository text,
  integrity_hash text,
  authentication_type text,
  network_access text,
  filesystem_access text,
  secret_access text,
  installation_source text,
  configuration_source text,
  observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_mcp_servers_passport_idx ON agent_mcp_servers (tenant_id, passport_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_mcp_tools (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  mcp_server_id text NOT NULL,
  tool_name text NOT NULL,
  description text,
  input_schema_hash text,
  output_schema_hash text,
  declared_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_mcp_tools_passport_idx ON agent_mcp_tools (tenant_id, passport_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_handoffs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  parent_agent_id text NOT NULL,
  child_agent_id text NOT NULL,
  request_hash text,
  raw_result_hash text,
  summary_hash text,
  verification_state text NOT NULL CHECK (verification_state IN ('VERIFIED','UNVERIFIED','UNKNOWN')),
  evidence_id text,
  observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_handoffs_passport_idx ON agent_handoffs (tenant_id, passport_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_trust_snapshots (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  scan_id text,
  source_ref text,
  snapshot_hash text NOT NULL,
  payload jsonb NOT NULL,
  observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_trust_snapshots_passport_idx ON agent_trust_snapshots (tenant_id, passport_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS agent_trust_changes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  scan_id text,
  previous_snapshot_id text,
  current_snapshot_id text NOT NULL,
  change_type text NOT NULL,
  subject text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_trust_changes_passport_idx ON agent_trust_changes (tenant_id, passport_id, observed_at DESC);

DO $
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['agent_assets','agent_trust_boundaries','agent_capabilities','agent_mcp_servers','agent_mcp_tools','agent_handoffs','agent_trust_snapshots','agent_trust_changes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=table_name AND policyname='spr_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    FOREACH table_name IN ARRAY ARRAY['agent_assets','agent_trust_boundaries','agent_capabilities','agent_mcp_servers','agent_mcp_tools','agent_handoffs','agent_trust_snapshots','agent_trust_changes']
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_app_runtime', table_name);
    END LOOP;
  END IF;
END $$;

-- Worker jobs intentionally claim work across tenants. They still use the
-- least-privilege spr_worker_runtime role, but need an explicit cross-tenant
-- RLS policy on these tables just like the existing scan/evidence queues.
DO $
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    FOREACH table_name IN ARRAY ARRAY['agent_assets','agent_trust_boundaries','agent_capabilities','agent_mcp_servers','agent_mcp_tools','agent_handoffs','agent_trust_snapshots','agent_trust_changes']
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_worker_runtime', table_name);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename=table_name AND policyname='spr_worker_cross_tenant'
      ) THEN
        EXECUTE format('CREATE POLICY spr_worker_cross_tenant ON %I TO spr_worker_runtime USING (true) WITH CHECK (true)', table_name);
      END IF;
    END LOOP;
  END IF;
END $;

COMMIT;
