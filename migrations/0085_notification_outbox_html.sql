BEGIN;

-- Branded transactional email (src/lib/branded-email.ts) renders an HTML
-- body alongside the plain-text one. Queued messages need somewhere to keep
-- it; the worker sends html when present and text either way.
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS html text;

COMMIT;
