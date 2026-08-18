BEGIN;

-- ============================================================================
-- API-key scope and lifecycle integrity
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM spr_api_keys
    WHERE jsonb_typeof(scopes::jsonb) <> 'array'
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(scopes::jsonb) AS scope
         WHERE scope NOT IN ('read', 'write', 'webhooks')
       )
       OR jsonb_array_length(scopes::jsonb) < 1
       OR jsonb_array_length(scopes::jsonb) > 3
       OR jsonb_array_length(scopes::jsonb) <> (
         SELECT COUNT(DISTINCT scope)
         FROM jsonb_array_elements_text(scopes::jsonb) AS scope
       )
  ) THEN
    RAISE EXCEPTION 'API key scope integrity violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION spr_enforce_api_key_scope_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scope_count integer;
  distinct_count integer;
BEGIN
  IF jsonb_typeof(NEW.scopes::jsonb) <> 'array' THEN
    RAISE EXCEPTION 'API key scopes must be a JSON array';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT scope)
    INTO scope_count, distinct_count
  FROM jsonb_array_elements_text(NEW.scopes::jsonb) AS scope;

  IF scope_count < 1 OR scope_count > 3 OR scope_count <> distinct_count THEN
    RAISE EXCEPTION 'API key scopes must contain 1-3 unique values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW.scopes::jsonb) AS scope
    WHERE scope NOT IN ('read', 'write', 'webhooks')
  ) THEN
    RAISE EXCEPTION 'API key contains unsupported scope';
  END IF;

  IF NEW.expires_at IS NOT NULL AND NEW.expires_at = '' THEN
    RAISE EXCEPTION 'API key expires_at cannot be empty';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_api_key_scope_integrity ON spr_api_keys;
CREATE TRIGGER spr_api_key_scope_integrity
BEFORE INSERT OR UPDATE ON spr_api_keys
FOR EACH ROW EXECUTE FUNCTION spr_enforce_api_key_scope_integrity();

-- ============================================================================
-- Webhook tenant ownership and secret storage integrity
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.spr_webhooks') IS NULL THEN
    RAISE EXCEPTION 'spr_webhooks table is required before webhook hardening';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM spr_webhooks
    WHERE tenant_id IS NULL
       OR tenant_id = ''
       OR secret_hash IS NULL
       OR secret_hash !~ '^[0-9a-f]{64}$'
       OR url IS NULL
       OR url = ''
  ) THEN
    RAISE EXCEPTION 'Webhook integrity violation';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS spr_webhooks_tenant_active
  ON spr_webhooks (tenant_id, active, created_at DESC);

CREATE OR REPLACE FUNCTION spr_enforce_webhook_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.tenant_id = '' THEN
    RAISE EXCEPTION 'Webhook tenant_id is required';
  END IF;

  IF NEW.secret_hash IS NULL OR NEW.secret_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Webhook secret must be stored as SHA-256 hash only';
  END IF;

  IF NEW.url IS NULL OR length(NEW.url) > 2048 THEN
    RAISE EXCEPTION 'Webhook URL is invalid';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
       OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.secret_hash <> OLD.secret_hash THEN
      RAISE EXCEPTION 'Webhook identity, ownership, and secret hash are immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_webhook_integrity ON spr_webhooks;
CREATE TRIGGER spr_webhook_integrity
BEFORE INSERT OR UPDATE ON spr_webhooks
FOR EACH ROW EXECUTE FUNCTION spr_enforce_webhook_integrity();

COMMIT;
