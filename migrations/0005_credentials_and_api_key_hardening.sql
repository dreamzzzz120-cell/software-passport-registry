BEGIN;

-- ============================================================================
-- 1. CREDENTIAL REFERENCES: tenant ownership + fail-closed lifecycle
-- ============================================================================

CREATE INDEX IF NOT EXISTS credential_references_tenant_state
  ON credential_references (tenant_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS credential_references_tenant_provider
  ON credential_references (tenant_id, provider);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM credential_references
    WHERE tenant_id IS NULL
       OR provider = ''
       OR encrypted_payload = ''
       OR encryption_key_version = ''
       OR state NOT IN ('active', 'revoked')
       OR (state = 'active' AND revoked_at IS NOT NULL)
       OR (state = 'revoked' AND revoked_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'credential integrity violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION spr_enforce_credential_reference_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.tenant_id = '' THEN
    RAISE EXCEPTION 'credential tenant_id is required';
  END IF;

  IF NEW.provider IS NULL OR NEW.provider = '' THEN
    RAISE EXCEPTION 'credential provider is required';
  END IF;

  IF NEW.encrypted_payload IS NULL OR NEW.encrypted_payload = '' THEN
    RAISE EXCEPTION 'credential encrypted payload is required';
  END IF;

  IF NEW.encryption_key_version IS NULL OR NEW.encryption_key_version = '' THEN
    RAISE EXCEPTION 'credential encryption key version is required';
  END IF;

  IF NEW.state = 'active' AND NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'active credential cannot have revoked_at';
  END IF;

  IF NEW.state = 'revoked' AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'revoked credential must have revoked_at';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
       OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.created_by <> OLD.created_by
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'credential identity and ownership are immutable';
    END IF;

    IF OLD.state = 'revoked' AND NEW.state <> 'revoked' THEN
      RAISE EXCEPTION 'revoked credential cannot be reactivated';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_credential_reference_integrity ON credential_references;
CREATE TRIGGER spr_credential_reference_integrity
BEFORE INSERT OR UPDATE ON credential_references
FOR EACH ROW EXECUTE FUNCTION spr_enforce_credential_reference_integrity();

-- A credential reference may be reused by multiple monitoring records in the
-- same tenant, but its identifier can never be used to cross a tenant boundary.
CREATE OR REPLACE FUNCTION spr_enforce_monitoring_credential_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.credential_reference_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM credential_references cr
    WHERE cr.id = NEW.credential_reference_id
      AND cr.tenant_id = NEW.tenant_id
      AND cr.state = 'active'
  ) THEN
    RAISE EXCEPTION 'credential reference does not belong to tenant or is revoked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_monitoring_credential_tenant ON monitoring_configurations;
CREATE TRIGGER spr_monitoring_credential_tenant
BEFORE INSERT OR UPDATE ON monitoring_configurations
FOR EACH ROW EXECUTE FUNCTION spr_enforce_monitoring_credential_tenant();

-- ============================================================================
-- 2. API KEYS: hash-only storage + tenant isolation + one-way revocation
-- ============================================================================

CREATE TABLE IF NOT EXISTS spr_api_keys (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text NOT NULL DEFAULT '["read"]',
  expires_at text,
  last_used_at text,
  revoked_at text,
  created_by text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  CONSTRAINT spr_api_keys_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT spr_api_keys_prefix_safe CHECK (length(key_prefix) BETWEEN 8 AND 32),
  CONSTRAINT spr_api_keys_hash_sha256 CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT spr_api_keys_scopes_json CHECK (jsonb_typeof(scopes::jsonb) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS spr_api_keys_hash_unique
  ON spr_api_keys (key_hash);

CREATE INDEX IF NOT EXISTS spr_api_keys_tenant_created
  ON spr_api_keys (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS spr_api_keys_tenant_active
  ON spr_api_keys (tenant_id, revoked_at, expires_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM spr_api_keys
    WHERE tenant_id IS NULL
       OR length(btrim(name)) NOT BETWEEN 1 AND 120
       OR key_prefix IS NULL
       OR length(key_prefix) NOT BETWEEN 8 AND 32
       OR key_hash IS NULL
       OR key_hash !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(scopes::jsonb) <> 'array'
       OR jsonb_array_length(scopes::jsonb) NOT BETWEEN 1 AND 3
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(scopes::jsonb) AS scope(value)
         WHERE scope.value NOT IN ('read', 'write', 'webhooks')
       )
  ) THEN
    RAISE EXCEPTION 'API key integrity violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION spr_enforce_api_key_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.tenant_id = '' THEN
    RAISE EXCEPTION 'API key tenant_id is required';
  END IF;

  IF NEW.name IS NULL OR length(btrim(NEW.name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'API key name is invalid';
  END IF;

  IF NEW.key_hash IS NULL OR NEW.key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'API key must store a SHA-256 hash only';
  END IF;

  IF NEW.scopes IS NULL
     OR jsonb_typeof(NEW.scopes::jsonb) <> 'array'
     OR jsonb_array_length(NEW.scopes::jsonb) NOT BETWEEN 1 AND 3
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(NEW.scopes::jsonb) AS scope(value)
       WHERE scope.value NOT IN ('read', 'write', 'webhooks')
     ) THEN
    RAISE EXCEPTION 'API key scopes are invalid';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
       OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.key_prefix <> OLD.key_prefix
       OR NEW.key_hash <> OLD.key_hash
       OR NEW.created_by <> OLD.created_by
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'API key identity, secret hash, and ownership are immutable';
    END IF;

    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'revoked API key cannot be reactivated';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_api_key_integrity ON spr_api_keys;
CREATE TRIGGER spr_api_key_integrity
BEFORE INSERT OR UPDATE ON spr_api_keys
FOR EACH ROW EXECUTE FUNCTION spr_enforce_api_key_integrity();

COMMIT;
