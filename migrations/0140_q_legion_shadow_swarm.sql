BEGIN;

CREATE TABLE IF NOT EXISTS q_legion_missions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'SHADOW' CHECK (mode IN ('SHADOW','ACTIVE')),
  state TEXT NOT NULL CHECK (state IN ('UNKNOWN','HOLD','READY_FOR_EXECUTION')),
  advisory_strategy_id TEXT,
  authority_level TEXT NOT NULL DEFAULT 'NONE' CHECK (authority_level IN ('NONE','AGENT','CONSTELLATION','HUMAN')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategies JSONB NOT NULL DEFAULT '[]'::jsonb,
  red_team_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  judge_reviews JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision JSONB NOT NULL DEFAULT '{}'::jsonb,
  shadow_assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS q_legion_missions_tenant_time_idx
  ON q_legion_missions (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS q_legion_missions_state_idx
  ON q_legion_missions (tenant_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS q_legion_mission_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES q_legion_missions(id) ON DELETE RESTRICT,
  receipt_hash TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, receipt_hash)
);

CREATE INDEX IF NOT EXISTS q_legion_receipts_tenant_time_idx
  ON q_legion_mission_receipts (tenant_id, created_at DESC);

ALTER TABLE q_legion_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE q_legion_missions FORCE ROW LEVEL SECURITY;
ALTER TABLE q_legion_mission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE q_legion_mission_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spr_tenant_isolation ON q_legion_missions;
CREATE POLICY spr_tenant_isolation ON q_legion_missions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS spr_worker_cross_tenant ON q_legion_missions;
CREATE POLICY spr_worker_cross_tenant ON q_legion_missions
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');

DROP POLICY IF EXISTS spr_tenant_isolation ON q_legion_mission_receipts;
CREATE POLICY spr_tenant_isolation ON q_legion_mission_receipts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS spr_worker_cross_tenant ON q_legion_mission_receipts;
CREATE POLICY spr_worker_cross_tenant ON q_legion_mission_receipts
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON q_legion_missions TO spr_app_runtime;
    GRANT SELECT, INSERT ON q_legion_mission_receipts TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON q_legion_missions TO spr_worker_runtime;
    GRANT SELECT, INSERT ON q_legion_mission_receipts TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
