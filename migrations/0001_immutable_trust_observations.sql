ALTER TABLE passports ADD COLUMN IF NOT EXISTS client_id text;

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS passport_id text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS observation_id text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS change_type text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS deduplication_key text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS first_observed_at text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS last_observed_at text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS previous_status text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_at text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_at text;
CREATE UNIQUE INDEX IF NOT EXISTS alerts_tenant_dedup_unique
  ON alerts (tenant_id, deduplication_key) WHERE deduplication_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS trust_observations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  client_id text NOT NULL,
  asset_id text NOT NULL,
  schema_version text NOT NULL,
  observation_version integer NOT NULL CHECK (observation_version > 0),
  generated_at text NOT NULL,
  previous_observation_id text,
  evidence_ids text NOT NULL,
  finding_ids text NOT NULL,
  scoring_policy_version text NOT NULL,
  confidence_policy_version text NOT NULL,
  completeness_basis_points integer NOT NULL CHECK (completeness_basis_points BETWEEN 0 AND 10000),
  known_dimension_count integer NOT NULL CHECK (known_dimension_count >= 0),
  unknown_dimension_count integer NOT NULL CHECK (unknown_dimension_count >= 0),
  stale_dimension_count integer NOT NULL CHECK (stale_dimension_count >= 0),
  expired_dimension_count integer NOT NULL CHECK (expired_dimension_count >= 0),
  canonical_payload_hash text NOT NULL,
  immutable_payload text NOT NULL,
  UNIQUE (tenant_id, passport_id, observation_version)
);
CREATE INDEX IF NOT EXISTS trust_observations_tenant_passport_generated
  ON trust_observations (tenant_id, passport_id, observation_version DESC);

CREATE TABLE IF NOT EXISTS trust_observation_changes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  observation_id text NOT NULL,
  previous_observation_id text,
  change_type text NOT NULL,
  subject text NOT NULL,
  deduplication_key text NOT NULL,
  details text NOT NULL,
  created_at text NOT NULL,
  UNIQUE (tenant_id, observation_id, deduplication_key)
);
CREATE INDEX IF NOT EXISTS trust_changes_tenant_passport
  ON trust_observation_changes (tenant_id, passport_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_trust_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';
END;
$$;
DROP TRIGGER IF EXISTS trust_observations_immutable_update ON trust_observations;
CREATE TRIGGER trust_observations_immutable_update
BEFORE UPDATE OR DELETE ON trust_observations
FOR EACH ROW EXECUTE FUNCTION prevent_trust_observation_mutation();
