-- Repairs a divergence between the migration ledger and the production schema.
--
-- migrations/0045_traffic_telemetry.sql is recorded as applied in production
-- (the release step reports "executed": 0, "skipped": 74), but the table it
-- creates does not exist there. Every page view calls POST /api/traffic/event,
-- which fails with:
--
--   42P01  relation "traffic_events" does not exist
--
-- so the endpoint answers 503 site-wide and no traffic is recorded at all.
-- Because 0045 is already in the ledger it will never run again, so the fix
-- has to arrive as a new migration.
--
-- This restates 0045 verbatim. Every statement is idempotent, so it is a no-op
-- on any database where 0045 genuinely did apply (including staging and local
-- development) and repairs the one where it did not.
--
-- The ledger divergence itself is not addressed here and is worth a separate
-- look: if 0045 was skipped without applying, other migrations may have been
-- too, and that cannot be confirmed without reading the production schema.

BEGIN;

CREATE TABLE IF NOT EXISTS traffic_events (
  id text PRIMARY KEY,
  occurred_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  session_id text NOT NULL,
  path text NOT NULL,
  referrer text,
  user_agent text,
  country text,
  device_type text NOT NULL DEFAULT 'unknown' CHECK (device_type IN ('mobile','tablet','desktop','unknown'))
);

CREATE INDEX IF NOT EXISTS traffic_events_occurred_idx ON traffic_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS traffic_events_session_idx ON traffic_events (session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS traffic_events_path_idx ON traffic_events (path, occurred_at DESC);

ALTER TABLE traffic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE traffic_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_traffic_service ON traffic_events;
CREATE POLICY spr_traffic_service ON traffic_events FOR ALL USING (current_user IN ('spr_app_runtime','spr_worker_runtime')) WITH CHECK (current_user IN ('spr_app_runtime','spr_worker_runtime'));

COMMIT;
