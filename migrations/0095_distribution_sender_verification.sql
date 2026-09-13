BEGIN;

-- Durable state for the one-time production outreach-sender verification.
-- Kept separate from prospect/contact data so sender verification does not
-- depend on a prospect existing.
CREATE TABLE IF NOT EXISTS distribution_sender_verifications (
  id text PRIMARY KEY,
  from_address text NOT NULL,
  to_address text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','failed')),
  provider_message_id text,
  error text,
  sent_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS distribution_sender_verifications_sent_pair_idx
  ON distribution_sender_verifications (lower(from_address), lower(to_address))
  WHERE status = 'sent';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_sender_verifications TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
