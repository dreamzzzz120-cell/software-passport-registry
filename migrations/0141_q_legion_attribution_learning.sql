BEGIN;

CREATE TABLE IF NOT EXISTS q_legion_settings (
  tenant_id text PRIMARY KEY,
  strategy_execution_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO q_legion_settings (tenant_id, strategy_execution_enabled)
VALUES ('tenant-free-review-system', true)
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE q_legion_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE q_legion_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spr_tenant_isolation ON q_legion_settings;
CREATE POLICY spr_tenant_isolation ON q_legion_settings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE distribution_messages
  ADD COLUMN IF NOT EXISTS q_legion_mission_id text,
  ADD COLUMN IF NOT EXISTS q_legion_strategy_id text,
  ADD COLUMN IF NOT EXISTS q_legion_strategy_probability double precision;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='distribution_messages_q_legion_mission_fk'
  ) THEN
    ALTER TABLE distribution_messages
      ADD CONSTRAINT distribution_messages_q_legion_mission_fk
      FOREIGN KEY (q_legion_mission_id) REFERENCES q_legion_missions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS distribution_messages_q_legion_strategy_idx
  ON distribution_messages (tenant_id, q_legion_strategy_id, sent_at DESC)
  WHERE q_legion_strategy_id IS NOT NULL;

ALTER TABLE distribution_contacts
  ADD COLUMN IF NOT EXISTS checkout_at timestamp;

ALTER TABLE distribution_contacts DROP CONSTRAINT IF EXISTS distribution_contacts_pipeline_stage_check;
ALTER TABLE distribution_contacts ADD CONSTRAINT distribution_contacts_pipeline_stage_check
  CHECK (pipeline_stage IN ('new','qualified','contacted','replied','demo','checkout','pilot','customer','lost'));

CREATE OR REPLACE FUNCTION spr_distribution_stage_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pipeline_stage IN ('replied','demo','checkout','pilot','customer','lost') THEN
    NEW.next_followup_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON q_legion_settings TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT ON q_legion_settings TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
