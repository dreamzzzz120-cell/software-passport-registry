BEGIN;

-- MSP technician assignment: which team member is responsible for a given
-- client. One active assignment per client; reassigning replaces it rather
-- than accumulating history (the audit trail already records the change).
CREATE TABLE IF NOT EXISTS client_assignments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  technician_user_id integer,
  technician_display text NOT NULL,
  assigned_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE(tenant_id, client_id)
);
CREATE INDEX IF NOT EXISTS client_assignments_tenant_scope ON client_assignments(tenant_id, client_id);

-- AI Trust Center: a self-reported inventory of the tenant's own AI systems
-- (agents, models, copilots). Unlike passports/evidence, SPR has no
-- auto-discovery mechanism for AI usage, so this registry is explicitly
-- manual — status/permissions/tool access are what the tenant declares, not
-- an authoritatively observed fact. Observations below are the append-only
-- log of security/privacy/access/model-change notes attached to a system.
CREATE TABLE IF NOT EXISTS ai_systems (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  vendor text NOT NULL,
  model text NOT NULL,
  version text NOT NULL DEFAULT 'unspecified',
  purpose text NOT NULL DEFAULT '',
  data_classification text NOT NULL DEFAULT 'unclassified' CHECK (data_classification IN ('unclassified','internal','confidential','regulated')),
  status text NOT NULL DEFAULT 'under_review' CHECK (status IN ('active','under_review','deprecated','blocked')),
  tool_access text NOT NULL DEFAULT '[]',
  permissions text NOT NULL DEFAULT '[]',
  owner_display text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_systems_tenant_scope ON ai_systems(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ai_systems_tenant_id_unique ON ai_systems(tenant_id, id);

CREATE TABLE IF NOT EXISTS ai_system_observations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  ai_system_id text NOT NULL,
  observation_type text NOT NULL CHECK (observation_type IN ('security','privacy','access_change','model_change','vendor_assessment','other')),
  summary text NOT NULL,
  detail text NOT NULL DEFAULT '',
  observed_by text NOT NULL,
  created_at text NOT NULL,
  FOREIGN KEY (tenant_id, ai_system_id) REFERENCES ai_systems(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_system_observations_scope ON ai_system_observations(tenant_id, ai_system_id, created_at DESC);

-- Enable the same defense-in-depth Row-Level Security every other
-- tenant-scoped table has (migration 0020) — new tables do not inherit it
-- automatically, only ones that existed when that migration's loop ran.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['client_assignments', 'ai_systems', 'ai_system_observations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'spr_tenant_isolation') THEN
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_assignments, ai_systems, ai_system_observations TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_assignments, ai_systems, ai_system_observations TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
