BEGIN;

ALTER TABLE provider_customers
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE','ABSENT')),
  ADD COLUMN IF NOT EXISTS last_seen_run_id text,
  ADD COLUMN IF NOT EXISTS absent_since timestamp;

CREATE INDEX IF NOT EXISTS provider_customers_lifecycle_idx
  ON provider_customers (tenant_id, provider, lifecycle_status);

-- Deliberately no FK from last_seen_run_id: provider customer history remains
-- readable even if operational discovery-run retention is introduced later.
COMMIT;
