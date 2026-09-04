BEGIN;

-- Stripe webhook rows are a durable inbox, not a permanent "seen" marker.
-- A delivery is only considered processed after its business logic commits.
ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at timestamp,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS billing_webhook_events_unprocessed_idx
  ON billing_webhook_events (processed_at, received_at)
  WHERE processed_at IS NULL;

-- Trigger the one-time repository patch after this migration exists.
COMMIT;
