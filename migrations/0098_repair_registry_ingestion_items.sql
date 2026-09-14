BEGIN;

-- Production schema-drift repair: migration 0091 may be recorded as applied in
-- an environment where registry_ingestion_items was never created. The public
-- repository discovery worker depends on this operational ledger. Keep this
-- repair idempotent and non-customer-facing.
CREATE TABLE IF NOT EXISTS registry_ingestion_items (
  id text PRIMARY KEY,
  provider text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  canonical_url text NOT NULL,
  status text NOT NULL DEFAULT 'discovered',
  passport_id text,
  discovery_agent text NOT NULL DEFAULT 'discovery',
  identity_agent text,
  evidence_agent text,
  verification_agent text,
  quality_agent text,
  discovered_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at timestamp,
  next_refresh_at timestamp,
  default_branch text,
  head_sha text,
  stars integer NOT NULL DEFAULT 0,
  language text,
  license_spdx text,
  evidence_hash text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  quarantined_reason text,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, repository_owner, repository_name)
);

CREATE INDEX IF NOT EXISTS registry_ingestion_status_idx
  ON registry_ingestion_items(status, next_refresh_at);
CREATE INDEX IF NOT EXISTS registry_ingestion_observed_idx
  ON registry_ingestion_items(last_observed_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON registry_ingestion_items TO spr_worker_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT ON registry_ingestion_items TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
