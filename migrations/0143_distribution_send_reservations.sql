BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE distribution_campaign_settings
  ADD COLUMN IF NOT EXISTS last_send_reserved_at timestamptz;

-- Durable before the external send. An uncertain send remains reserved until
-- reconciled; a worker restart must never manufacture a new logical email.
CREATE TABLE IF NOT EXISTS distribution_send_attempts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL CHECK (tenant_id = 'tenant-free-review-system'),
  contact_id text NOT NULL REFERENCES distribution_contacts(id),
  kind text NOT NULL CHECK (kind IN ('initial','followup')),
  sequence integer NOT NULL CHECK (sequence >= 0),
  status text NOT NULL CHECK (status IN ('reserved','sent','retryable','blocked','unknown')),
  reserved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retry_at timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, contact_id, kind, sequence),
  CHECK ((kind='initial' AND sequence=0) OR (kind='followup' AND sequence>0))
);

CREATE INDEX IF NOT EXISTS distribution_send_attempts_unresolved_idx
  ON distribution_send_attempts (tenant_id, status)
  WHERE status IN ('reserved','unknown');

ALTER TABLE distribution_send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_send_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY spr_tenant_isolation ON distribution_send_attempts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_send_attempts TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_send_attempts TO spr_worker_runtime;
    GRANT UPDATE (last_send_reserved_at) ON distribution_campaign_settings TO spr_worker_runtime;
    CREATE POLICY spr_worker_cross_tenant ON distribution_send_attempts
      FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END $$;

COMMIT;
