BEGIN;

ALTER TABLE spr_webhooks
  ADD COLUMN IF NOT EXISTS secret_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM spr_webhooks WHERE secret_version < 1) THEN
    RAISE EXCEPTION 'Invalid webhook secret version';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS spr_webhooks_tenant_active
  ON spr_webhooks (tenant_id, active, created_at DESC);

CREATE OR REPLACE FUNCTION spr_enforce_webhook_secret_storage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active = true AND (NEW.secret_ciphertext IS NULL OR NEW.secret_ciphertext = '' OR NEW.secret_key_version IS NULL OR NEW.secret_key_version = '') THEN
    RAISE EXCEPTION 'Active webhook requires encrypted signing secret';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'Webhook identity and ownership are immutable';
    END IF;
    IF NEW.secret_version < OLD.secret_version OR NEW.secret_version > OLD.secret_version + 1 THEN
      RAISE EXCEPTION 'Webhook secret version must increase by exactly one';
    END IF;
    IF NEW.secret_version = OLD.secret_version AND (
      NEW.secret_hash IS DISTINCT FROM OLD.secret_hash OR
      NEW.secret_ciphertext IS DISTINCT FROM OLD.secret_ciphertext OR
      NEW.secret_key_version IS DISTINCT FROM OLD.secret_key_version
    ) THEN
      RAISE EXCEPTION 'Webhook secret material may only change during explicit rotation';
    END IF;
    IF NEW.secret_version = OLD.secret_version + 1 AND (
      NEW.secret_hash IS NULL OR NEW.secret_hash !~ '^[0-9a-f]{64}$' OR
      NEW.secret_ciphertext IS NULL OR NEW.secret_ciphertext = '' OR
      NEW.secret_key_version IS NULL OR NEW.secret_key_version = ''
    ) THEN
      RAISE EXCEPTION 'Webhook rotation requires complete secret material';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_webhook_secret_storage ON spr_webhooks;
CREATE TRIGGER spr_webhook_secret_storage
BEFORE INSERT OR UPDATE ON spr_webhooks
FOR EACH ROW EXECUTE FUNCTION spr_enforce_webhook_secret_storage();

CREATE OR REPLACE FUNCTION spr_enforce_observation_completeness()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.completeness_basis_points < 0 OR NEW.completeness_basis_points > 10000 THEN
    RAISE EXCEPTION 'Observation completeness must be between 0 and 10000 basis points';
  END IF;
  IF NEW.known_dimension_count < 0 OR NEW.unknown_dimension_count < 0
     OR NEW.stale_dimension_count < 0 OR NEW.expired_dimension_count < 0
     OR NEW.partially_known_dimension_count < 0 OR NEW.unavailable_dimension_count < 0 THEN
    RAISE EXCEPTION 'Observation dimension counts cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_observation_completeness ON trust_observations;
CREATE TRIGGER spr_observation_completeness
BEFORE INSERT ON trust_observations
FOR EACH ROW EXECUTE FUNCTION spr_enforce_observation_completeness();

CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_version_unique
  ON schema_migrations (version);

COMMIT;
