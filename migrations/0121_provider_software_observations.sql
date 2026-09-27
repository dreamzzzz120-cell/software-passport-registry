BEGIN;

CREATE TABLE IF NOT EXISTS provider_software_observations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  provider_customer_id text NOT NULL,
  client_id text,
  external_device_id text NOT NULL,
  external_software_id text,
  observed_name text NOT NULL,
  observed_publisher text,
  observed_version text,
  observed_product_code text,
  observed_package_id text,
  canonical_name text NOT NULL,
  canonical_publisher text,
  canonical_version text,
  normalization_disposition text NOT NULL CHECK (normalization_disposition IN ('matched','review','unknown')),
  normalization_confidence numeric NOT NULL CHECK (normalization_confidence >= 0 AND normalization_confidence <= 1),
  passport_id text,
  source_observed_at timestamp NOT NULL,
  collected_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  freshness_state text NOT NULL CHECK (freshness_state IN ('CURRENT','STALE','UNKNOWN')),
  raw_observation jsonb NOT NULL,
  observation_hash text NOT NULL,
  UNIQUE (tenant_id, provider, provider_customer_id, external_device_id, observation_hash)
);

CREATE INDEX IF NOT EXISTS provider_software_observations_lineage_idx
  ON provider_software_observations (tenant_id, provider_customer_id, external_device_id, canonical_name);
CREATE INDEX IF NOT EXISTS provider_software_observations_passport_idx
  ON provider_software_observations (tenant_id, passport_id) WHERE passport_id IS NOT NULL;

ALTER TABLE provider_software_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_software_observations FORCE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='provider_software_observations' AND policyname='spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON provider_software_observations
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='provider_software_observations' AND policyname='spr_worker_cross_tenant') THEN
    CREATE POLICY spr_worker_cross_tenant ON provider_software_observations
      FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END
$policy$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON provider_software_observations TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON provider_software_observations TO spr_worker_runtime;
  END IF;
END
$grants$;

COMMIT;
