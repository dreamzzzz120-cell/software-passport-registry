BEGIN;

-- Repair migration: ensure registry_crawl_state.strategy_index and query_index exist.
-- Migration 0091 attempted to add these columns with IF NOT EXISTS, but in some
-- environments (notably production with schema drift) they were never applied.
-- This idempotent repair ensures they exist before multi-strategy discovery work.

-- Add strategy_index and query_index to registry_crawl_state if missing.
-- These columns track the current discovery strategy and query cursor position.
ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS strategy_index integer NOT NULL DEFAULT 0 CHECK (strategy_index >= 0);
ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS query_index integer NOT NULL DEFAULT 0 CHECK (query_index >= 0);

-- Ensure registry_crawl_runs has refreshed/quarantined/failed counters.
-- These track outcomes of each crawl run; if present from 0091, this is a no-op.
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS refreshed integer NOT NULL DEFAULT 0;
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS quarantined integer NOT NULL DEFAULT 0;
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0;

-- Ensure roles have the required permissions on the new columns (idempotent).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON registry_crawl_state, registry_crawl_runs TO spr_worker_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT ON registry_crawl_state, registry_crawl_runs TO spr_app_runtime;
  END IF;
END $$;

COMMIT;

