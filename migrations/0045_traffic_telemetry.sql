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
