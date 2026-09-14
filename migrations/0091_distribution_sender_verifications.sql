BEGIN;

-- Public-repository ingestion ledger. This is operational metadata only; it does
-- not contain customer data and never stores repository owner contact data.
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
CREATE INDEX IF NOT EXISTS registry_ingestion_status_idx ON registry_ingestion_items(status, next_refresh_at);
CREATE INDEX IF NOT EXISTS registry_ingestion_observed_idx ON registry_ingestion_items(last_observed_at DESC);

-- Extend the discovery cursor without breaking the existing crawler state.
ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS strategy_index integer NOT NULL DEFAULT 0 CHECK (strategy_index >= 0);
ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS query_index integer NOT NULL DEFAULT 0 CHECK (query_index >= 0);

ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS refreshed integer NOT NULL DEFAULT 0;
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS quarantined integer NOT NULL DEFAULT 0;
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON registry_ingestion_items TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE ON registry_crawl_state, registry_crawl_runs TO spr_worker_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT ON registry_ingestion_items, registry_crawl_state, registry_crawl_runs TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
