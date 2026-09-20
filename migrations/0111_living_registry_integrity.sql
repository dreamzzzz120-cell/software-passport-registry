BEGIN;

-- 0111: living software registry integrity.
-- Global registry infrastructure: stable identities, explicit aliases,
-- append-only observations, conflicts, and refresh state. No trust score or
-- certification is fabricated here; this layer records observations.

CREATE TABLE IF NOT EXISTS software_registry_identities (
  id text PRIMARY KEY,
  provider text NOT NULL,
  canonical_key text NOT NULL,
  canonical_name text NOT NULL,
  repository_owner text,
  repository_name text,
  canonical_url text,
  identity_status text NOT NULL DEFAULT 'observed'
    CHECK (identity_status IN ('observed','verified','conflicted','quarantined','retired')),
  first_observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at timestamptz,
  latest_commit_sha text CHECK (latest_commit_sha IS NULL OR latest_commit_sha ~ '^[a-f0-9]{40}$'),
  default_branch text,
  stars integer NOT NULL DEFAULT 0 CHECK (stars >= 0),
  language text,
  license_spdx text,
  next_refresh_at timestamptz,
  observation_count integer NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, canonical_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS software_registry_identity_repo_unique
  ON software_registry_identities (provider, lower(repository_owner), lower(repository_name))
  WHERE repository_owner IS NOT NULL AND repository_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS software_registry_identity_refresh_idx
  ON software_registry_identities (next_refresh_at NULLS FIRST, last_observed_at);
CREATE INDEX IF NOT EXISTS software_registry_identity_name_idx
  ON software_registry_identities (lower(canonical_name));

CREATE TABLE IF NOT EXISTS software_registry_aliases (
  id text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES software_registry_identities(id) ON DELETE RESTRICT,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  alias_type text NOT NULL DEFAULT 'observed'
    CHECK (alias_type IN ('observed','package','repository','provider','historical')),
  source_observation_id text,
  first_observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (normalized_alias, identity_id)
);
CREATE INDEX IF NOT EXISTS software_registry_alias_lookup_idx
  ON software_registry_aliases (normalized_alias);

CREATE TABLE IF NOT EXISTS software_registry_observations (
  id text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES software_registry_identities(id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_locator text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^[a-f0-9]{40}$'),
  payload_hash text NOT NULL,
  outcome text NOT NULL DEFAULT 'observed'
    CHECK (outcome IN ('observed','verified','partial','failed','conflicted')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (identity_id, source_type, source_locator, commit_sha, payload_hash)
);
CREATE INDEX IF NOT EXISTS software_registry_observations_identity_idx
  ON software_registry_observations (identity_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS software_registry_observations_source_idx
  ON software_registry_observations (source_type, source_locator, observed_at DESC);

CREATE TABLE IF NOT EXISTS software_registry_conflicts (
  id text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES software_registry_identities(id) ON DELETE RESTRICT,
  field_name text NOT NULL,
  left_observation_id text NOT NULL REFERENCES software_registry_observations(id) ON DELETE RESTRICT,
  right_observation_id text NOT NULL REFERENCES software_registry_observations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','accepted_unknown')),
  resolution_observation_id text REFERENCES software_registry_observations(id) ON DELETE RESTRICT,
  detected_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS software_registry_conflicts_open_idx
  ON software_registry_conflicts (identity_id, status, detected_at DESC);

ALTER TABLE registry_ingestion_items
  ADD COLUMN IF NOT EXISTS identity_id text REFERENCES software_registry_identities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS canonical_key text,
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'unknown'
    CHECK (quality_status IN ('unknown','partial','good','conflicted','quarantined')),
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS refresh_reason text,
  ADD COLUMN IF NOT EXISTS observation_count integer NOT NULL DEFAULT 0 CHECK (observation_count >= 0);

CREATE INDEX IF NOT EXISTS registry_ingestion_identity_idx ON registry_ingestion_items (identity_id);
CREATE INDEX IF NOT EXISTS registry_ingestion_refresh_idx ON registry_ingestion_items (next_refresh_at, status);

CREATE OR REPLACE FUNCTION public.prevent_registry_observation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS 'BEGIN
  RAISE EXCEPTION ''REGISTRY_OBSERVATION_IMMUTABLE'';
END;';
DROP TRIGGER IF EXISTS software_registry_observations_immutable ON software_registry_observations;
CREATE TRIGGER software_registry_observations_immutable
BEFORE UPDATE OR DELETE ON software_registry_observations
FOR EACH ROW EXECUTE FUNCTION public.prevent_registry_observation_mutation();

ALTER TABLE public.software_registry_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.software_registry_conflicts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spr_registry_app_read ON public.software_registry_identities;
CREATE POLICY spr_registry_app_read ON public.software_registry_identities
  FOR SELECT TO spr_app_runtime USING (current_user = 'spr_app_runtime');
DROP POLICY IF EXISTS spr_registry_app_read ON public.software_registry_aliases;
CREATE POLICY spr_registry_app_read ON public.software_registry_aliases
  FOR SELECT TO spr_app_runtime USING (current_user = 'spr_app_runtime');
DROP POLICY IF EXISTS spr_registry_app_read ON public.software_registry_observations;
CREATE POLICY spr_registry_app_read ON public.software_registry_observations
  FOR SELECT TO spr_app_runtime USING (current_user = 'spr_app_runtime');
DROP POLICY IF EXISTS spr_registry_app_read ON public.software_registry_conflicts;
CREATE POLICY spr_registry_app_read ON public.software_registry_conflicts
  FOR SELECT TO spr_app_runtime USING (current_user = 'spr_app_runtime');

DROP POLICY IF EXISTS spr_registry_worker_all ON public.software_registry_identities;
CREATE POLICY spr_registry_worker_all ON public.software_registry_identities
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');
DROP POLICY IF EXISTS spr_registry_worker_all ON public.software_registry_aliases;
CREATE POLICY spr_registry_worker_all ON public.software_registry_aliases
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');
DROP POLICY IF EXISTS spr_registry_worker_all ON public.software_registry_observations;
CREATE POLICY spr_registry_worker_all ON public.software_registry_observations
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');
DROP POLICY IF EXISTS spr_registry_worker_all ON public.software_registry_conflicts;
CREATE POLICY spr_registry_worker_all ON public.software_registry_conflicts
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');

GRANT SELECT ON public.software_registry_identities, public.software_registry_aliases,
  public.software_registry_observations, public.software_registry_conflicts TO spr_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.software_registry_identities,
  public.software_registry_aliases, public.software_registry_observations,
  public.software_registry_conflicts TO spr_worker_runtime;

ALTER TABLE public.registry_ingestion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_ingestion_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_registry_ingestion_app_read ON public.registry_ingestion_items;
CREATE POLICY spr_registry_ingestion_app_read ON public.registry_ingestion_items
  FOR SELECT TO spr_app_runtime USING (current_user = 'spr_app_runtime');
DROP POLICY IF EXISTS spr_registry_ingestion_worker_all ON public.registry_ingestion_items;
CREATE POLICY spr_registry_ingestion_worker_all ON public.registry_ingestion_items
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');
GRANT SELECT ON public.registry_ingestion_items TO spr_app_runtime;
GRANT SELECT, INSERT, UPDATE ON public.registry_ingestion_items TO spr_worker_runtime;

COMMIT;
