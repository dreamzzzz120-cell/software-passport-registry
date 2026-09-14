BEGIN;

-- One row per outreach sender verification the worker performed: a real
-- message sent through the provider from the configured outreach address to
-- the configured verification inbox, with the provider's answer recorded.
-- Idempotent on (from, to): the worker sends once per pair, so redeploys do
-- not re-send. Operational telemetry, not tenant data.
CREATE TABLE IF NOT EXISTS distribution_sender_verifications (
  id text PRIMARY KEY,
  from_address text NOT NULL,
  to_address text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id text,
  error text,
  sent_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS distribution_sender_verifications_pair_idx
  ON distribution_sender_verifications (lower(from_address), lower(to_address))
  WHERE status = 'sent';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT ON distribution_sender_verifications TO spr_worker_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT ON distribution_sender_verifications TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
