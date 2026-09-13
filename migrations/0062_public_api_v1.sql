BEGIN;

-- Public API v1: support high-volume key lookup and make passport identity
-- registration race-safe within a tenant.
CREATE INDEX IF NOT EXISTS spr_api_keys_hash_active
  ON spr_api_keys (key_hash, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS spr_api_keys_last_used
  ON spr_api_keys (tenant_id, last_used_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS passports_api_identity_unique
  ON passports (tenant_id, lower(name), version, lower(file_hash));

COMMIT;
