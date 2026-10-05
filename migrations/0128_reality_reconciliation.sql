BEGIN;

-- 0128: Autonomous Reality Reconciliation.
-- Platform-wide operational evidence. Founder reads use the privileged connection;
-- the worker gets only the minimum rights needed to observe and append receipts.

CREATE TABLE IF NOT EXISTS reality_contracts (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  description TEXT NOT NULL,
  expected JSONB NOT NULL DEFAULT '{}'::jsonb,
  repair_class INTEGER NOT NULL DEFAULT 0 CHECK (repair_class BETWEEN 0 AND 3),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reality_observations (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES reality_contracts(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('HEALTHY','DEGRADING','FAILED','UNKNOWN')),
  observed JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reality_observations_contract_time
  ON reality_observations(contract_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS reality_incidents (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES reality_contracts(id),
  component TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status TEXT NOT NULL DEFAULT 'INVESTIGATING'
    CHECK (status IN ('INVESTIGATING','REPAIRING','VERIFYING','PROVEN_FIXED','PARTIALLY_REMEDIATED','FAILED','UNKNOWN')),
  expected JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  root_cause_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (root_cause_state IN ('PROVEN','SUPPORTED','UNKNOWN')),
  root_cause TEXT,
  impact JSONB NOT NULL DEFAULT '{}'::jsonb,
  repair_class INTEGER NOT NULL CHECK (repair_class BETWEEN 0 AND 3),
  repair_action TEXT,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reality_one_open_incident
  ON reality_incidents(contract_id)
  WHERE status NOT IN ('PROVEN_FIXED','FAILED');
CREATE INDEX IF NOT EXISTS idx_reality_incidents_status_time
  ON reality_incidents(status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS reality_repair_receipts (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES reality_incidents(id),
  authority_class INTEGER NOT NULL CHECK (authority_class BETWEEN 0 AND 3),
  before_state JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  cause TEXT,
  impact JSONB NOT NULL DEFAULT '{}'::jsonb,
  repair TEXT NOT NULL,
  verification JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB,
  result TEXT NOT NULL CHECK (result IN ('PROVEN_FIXED','FAILED','PARTIALLY_REMEDIATED','UNKNOWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reality_receipts_incident_time
  ON reality_repair_receipts(incident_id, created_at DESC);

INSERT INTO reality_contracts (id, component, description, expected, repair_class)
VALUES
  ('database_reachable','Postgres','Database accepts a real query.', '{"reachable":true}'::jsonb,0),
  ('worker_queue_flow','Worker queue','Queued jobs do not silently stall.', '{"oldestQueuedMinutesLt":10,"oldestRunningMinutesLt":30}'::jsonb,0),
  ('scan_terminality','Scan pipeline','Active scans make progress and reach a terminal state.', '{"staleActiveMinutesLt":30}'::jsonb,0),
  ('registry_freshness','Public registry crawler','Crawler produces a recent run when enabled.', '{"freshnessHoursLt":24}'::jsonb,0),
  ('reconciler_self_watch','Reality reconciler','The watcher records a fresh observation of itself.', '{"freshnessMinutesLt":10}'::jsonb,0)
ON CONFLICT (id) DO UPDATE SET
  component=EXCLUDED.component,
  description=EXCLUDED.description,
  expected=EXCLUDED.expected,
  repair_class=EXCLUDED.repair_class,
  updated_at=now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT ON reality_contracts TO spr_worker_runtime;
    GRANT SELECT, INSERT ON reality_observations TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE ON reality_incidents TO spr_worker_runtime;
    GRANT SELECT, INSERT ON reality_repair_receipts TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
