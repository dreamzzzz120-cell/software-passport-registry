BEGIN;

ALTER TABLE distribution_contacts
  ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS replied_at timestamp,
  ADD COLUMN IF NOT EXISTS demo_at timestamp,
  ADD COLUMN IF NOT EXISTS pilot_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_at timestamp,
  ADD COLUMN IF NOT EXISTS lost_at timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'distribution_contacts_pipeline_stage_check'
  ) THEN
    ALTER TABLE distribution_contacts
      ADD CONSTRAINT distribution_contacts_pipeline_stage_check
      CHECK (pipeline_stage IN ('new','qualified','contacted','replied','demo','pilot','customer','lost'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS distribution_contacts_pipeline_stage_idx
  ON distribution_contacts (tenant_id, pipeline_stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS distribution_campaign_settings (
  tenant_id text PRIMARY KEY DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  discovery_enabled boolean NOT NULL DEFAULT false,
  outreach_enabled boolean NOT NULL DEFAULT false,
  daily_send_cap integer NOT NULL DEFAULT 50 CHECK (daily_send_cap BETWEEN 1 AND 500),
  followup_delay_days integer NOT NULL DEFAULT 5 CHECK (followup_delay_days BETWEEN 1 AND 30),
  max_followups integer NOT NULL DEFAULT 2 CHECK (max_followups BETWEEN 0 AND 3),
  demo_url text,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO distribution_campaign_settings (tenant_id)
VALUES ('tenant-free-review-system')
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE distribution_campaign_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_campaign_settings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='distribution_campaign_settings'
      AND policyname='spr_tenant_isolation'
  ) THEN
    CREATE POLICY spr_tenant_isolation ON distribution_campaign_settings
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_campaign_settings TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT ON distribution_campaign_settings TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
