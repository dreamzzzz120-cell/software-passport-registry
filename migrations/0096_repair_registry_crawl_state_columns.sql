BEGIN;

-- Repair: Restore registry_crawl_state columns that 0091 intended to add but did
-- not fully apply due to ledger mismatch. This is idempotent and safe to run
-- even if the columns already exist. These columns are forward scaffolding for
-- multi-strategy discovery and must be present for schema consistency, though
-- the current cursor code still uses only language_index and page.
ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS strategy_index integer NOT NULL DEFAULT 0 CHECK (strategy_index >= 0);
ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS query_index integer NOT NULL DEFAULT 0 CHECK (query_index >= 0);

-- Restore the registry_crawl_runs columns that 0091 intended to add.
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS refreshed integer NOT NULL DEFAULT 0;
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS quarantined integer NOT NULL DEFAULT 0;
ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0;

COMMIT;

