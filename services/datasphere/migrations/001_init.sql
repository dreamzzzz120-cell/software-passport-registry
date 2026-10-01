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
  request_hash char(64) CHECK (request_hash ~ '^[0-9a-f]{64}$'),
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

ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS request_hash char(64);
ALTER TABLE datasphere_events DROP CONSTRAINT IF EXISTS datasphere_events_request_hash_check;
ALTER TABLE datasphere_events ADD CONSTRAINT datasphere_events_request_hash_check
  CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');

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

CREATE OR REPLACE FUNCTION datasphere_reject_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DATASPHERE_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS datasphere_events_no_truncate ON datasphere_events;
CREATE TRIGGER datasphere_events_no_truncate
BEFORE TRUNCATE ON datasphere_events
FOR EACH STATEMENT EXECUTE FUNCTION datasphere_reject_truncate();

ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS event_id uuid;
UPDATE datasphere_events SET event_id=id WHERE event_id IS NULL;
ALTER TABLE datasphere_events ALTER COLUMN event_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS datasphere_events_event_id_uidx ON datasphere_events(event_id);

ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS source_identity text;
UPDATE datasphere_events SET source_identity=source_system WHERE source_identity IS NULL;
ALTER TABLE datasphere_events ALTER COLUMN source_identity SET NOT NULL;

ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS galaxy_id text;
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS causation_id text;
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE datasphere_events SET occurred_at=observed_at WHERE occurred_at IS NULL;
ALTER TABLE datasphere_events ALTER COLUMN occurred_at SET NOT NULL;

ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS signing_algorithm text;
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS signing_key_id text;
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS signature_verified_at timestamptz;
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS signature_verification_result text
  CHECK (signature_verification_result IS NULL OR signature_verification_result IN ('VERIFIED','UNVERIFIED','CONFLICTING','INVALID','UNKNOWN'));
ALTER TABLE datasphere_events ADD COLUMN IF NOT EXISTS crypto_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS datasphere_events_algorithm_idx
  ON datasphere_events(signing_algorithm)
  WHERE signing_algorithm IS NOT NULL;
CREATE INDEX IF NOT EXISTS datasphere_events_key_idx
  ON datasphere_events(signing_key_id)
  WHERE signing_key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS datasphere_events_causation_idx
  ON datasphere_events(tenant_id,causation_id)
  WHERE causation_id IS NOT NULL;
