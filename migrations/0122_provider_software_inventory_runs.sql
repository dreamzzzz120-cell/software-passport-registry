BEGIN;

CREATE TABLE IF NOT EXISTS provider_software_inventory_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  provider_customer_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETE','PARTIAL','FAILED','UNSUPPORTED')),
  observations_fetched integer NOT NULL DEFAULT 0 CHECK (observations_fetched >= 0),
  limitation text,
  started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp,
  CHECK ((status = 'RUNNING' AND completed_at IS NULL) OR (status <> 'RUNNING' AND completed_at IS NOT NULL)),
  CHECK (status <> 'COMPLETE' OR limitation IS NULL),
  CHECK (status IN ('RUNNING','COMPLETE') OR limitation IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS provider_software_inventory_runs_tenant_idx
  ON provider_software_inventory_runs (tenant_id, provider, provider_customer_id, started_at DESC);

ALTER TABLE provider_software_inventory_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_software_inventory_runs FORCE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='provider_software_inventory_runs' AND policyname='spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON provider_software_inventory_runs
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='provider_software_inventory_runs' AND policyname='spr_worker_cross_tenant') THEN
    CREATE POLICY spr_worker_cross_tenant ON provider_software_inventory_runs
      FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END
$policy$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON provider_software_inventory_runs TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON provider_software_inventory_runs TO spr_worker_runtime;
  END IF;
END
$grants$;

COMMIT;
