BEGIN;

ALTER TABLE spr_webhooks
  ADD COLUMN IF NOT EXISTS secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS secret_key_version text,
  ADD COLUMN IF NOT EXISTS consecutive_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_at text;

UPDATE spr_webhooks
SET active = false,
    disabled_at = COALESCE(disabled_at, CURRENT_TIMESTAMP::text)
WHERE active = true AND secret_ciphertext IS NULL;

CREATE TABLE IF NOT EXISTS spr_webhook_deliveries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  webhook_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload text NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued',
  response_status integer,
  response_ms integer,
  safe_error_code text,
  safe_error_message text,
  next_attempt_at text NOT NULL,
  created_at text NOT NULL,
  started_at text,
  completed_at text
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM spr_webhooks WHERE active = true AND (secret_ciphertext IS NULL OR secret_key_version IS NULL)) THEN
    RAISE EXCEPTION 'Active webhook exists without encrypted signing secret';
  END IF;
  IF EXISTS (SELECT 1 FROM spr_webhook_deliveries WHERE tenant_id IS NULL OR tenant_id = '' OR webhook_id IS NULL OR webhook_id = '' OR event_id IS NULL OR event_id = '' OR event_type IS NULL OR event_type = '' OR idempotency_key IS NULL OR idempotency_key = '' OR attempt_number < 1 OR status NOT IN ('queued','running','succeeded','failed','dead_lettered')) THEN
    RAISE EXCEPTION 'Webhook delivery integrity violation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS spr_webhook_deliveries_idempotency ON spr_webhook_deliveries (tenant_id, webhook_id, idempotency_key);
CREATE INDEX IF NOT EXISTS spr_webhook_deliveries_due ON spr_webhook_deliveries (tenant_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS spr_webhook_deliveries_webhook ON spr_webhook_deliveries (tenant_id, webhook_id, created_at DESC);

CREATE OR REPLACE FUNCTION spr_enforce_webhook_delivery_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.tenant_id = '' OR NEW.webhook_id IS NULL OR NEW.webhook_id = '' THEN RAISE EXCEPTION 'Webhook delivery ownership is required'; END IF;
  IF NEW.attempt_number < 1 THEN RAISE EXCEPTION 'Webhook delivery attempt_number must be positive'; END IF;
  IF NEW.status NOT IN ('queued','running','succeeded','failed','dead_lettered') THEN RAISE EXCEPTION 'Invalid webhook delivery status'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.webhook_id <> OLD.webhook_id OR NEW.idempotency_key <> OLD.idempotency_key) THEN RAISE EXCEPTION 'Webhook delivery identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_webhook_delivery_integrity ON spr_webhook_deliveries;
CREATE TRIGGER spr_webhook_delivery_integrity BEFORE INSERT OR UPDATE ON spr_webhook_deliveries FOR EACH ROW EXECUTE FUNCTION spr_enforce_webhook_delivery_integrity();

CREATE OR REPLACE FUNCTION spr_enforce_webhook_secret_storage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active = true AND (NEW.secret_ciphertext IS NULL OR NEW.secret_ciphertext = '' OR NEW.secret_key_version IS NULL OR NEW.secret_key_version = '') THEN RAISE EXCEPTION 'Active webhook requires encrypted signing secret'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.secret_hash <> OLD.secret_hash OR COALESCE(NEW.secret_ciphertext,'') <> COALESCE(OLD.secret_ciphertext,'')) THEN RAISE EXCEPTION 'Webhook identity, ownership, hash, and encrypted secret are immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_webhook_secret_storage ON spr_webhooks;
CREATE TRIGGER spr_webhook_secret_storage BEFORE INSERT OR UPDATE ON spr_webhooks FOR EACH ROW EXECUTE FUNCTION spr_enforce_webhook_secret_storage();

COMMIT;
