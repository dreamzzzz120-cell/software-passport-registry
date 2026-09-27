BEGIN;

CREATE TABLE IF NOT EXISTS provider_customer_discovery_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','FAILED')),
  pages_fetched integer NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  records_fetched integer NOT NULL DEFAULT 0 CHECK (records_fetched >= 0),
  limitation text,
  started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp,
  CHECK ((status = 'COMPLETE' AND limitation IS NULL) OR status <> 'COMPLETE')
);
CREATE INDEX IF NOT EXISTS provider_customer_discovery_runs_tenant_idx
  ON provider_customer_discovery_runs (tenant_id, provider, started_at DESC);

ALTER TABLE provider_customer_discovery_runs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='provider_customer_discovery_runs' AND policyname='spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON provider_customer_discovery_runs
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON provider_customer_discovery_runs TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON provider_customer_discovery_runs TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
