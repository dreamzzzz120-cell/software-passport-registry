CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS datasphere_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  source_system text NOT NULL CHECK (source_system IN ('SPR','CONSTELLATION')),
  source_event_id text NOT NULL,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  previous_hash char(64),
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  verification_state text NOT NULL CHECK (verification_state IN ('VERIFIED','OBSERVED','DECLARED','UNKNOWN','STALE','CONFLICTING','UNAVAILABLE')),
  correlation_id text,
  parent_event_id text,
  retention_class text NOT NULL DEFAULT 'STANDARD',
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL,
  UNIQUE (tenant_id, source_system, source_event_id)
);

CREATE INDEX IF NOT EXISTS datasphere_events_tenant_time_idx
  ON datasphere_events (tenant_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS datasphere_events_subject_idx
  ON datasphere_events (tenant_id, subject_type, subject_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS datasphere_events_correlation_idx
  ON datasphere_events (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION datasphere_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DATASPHERE_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS datasphere_events_no_update ON datasphere_events;
CREATE TRIGGER datasphere_events_no_update
BEFORE UPDATE OR DELETE ON datasphere_events
FOR EACH ROW EXECUTE FUNCTION datasphere_reject_mutation();
