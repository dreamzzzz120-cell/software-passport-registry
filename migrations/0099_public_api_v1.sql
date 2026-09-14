BEGIN;

-- Public API v1: support high-volume key lookup and make passport identity
-- registration race-safe within a tenant.
CREATE INDEX IF NOT EXISTS spr_api_keys_hash_active
  ON spr_api_keys (key_hash, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS spr_api_keys_last_used
  ON spr_api_keys (tenant_id, last_used_at DESC);

-- Scoped to passports minted by the public API (ids are 'pass_<uuid>'; no
-- other code path uses that prefix). Production already holds legacy rows
-- that collide on this identity, so an unscoped unique index cannot be
-- built there (release 2026-09-14T05:23Z failed on it), and deciding which
-- legacy duplicates survive is a data decision, not a migration's. The
-- route's pre-insert lookup still matches legacy rows; this index closes
-- the concurrent-registration race between API callers.
CREATE UNIQUE INDEX IF NOT EXISTS passports_api_identity_unique
  ON passports (tenant_id, lower(name), version, lower(file_hash))
  WHERE id LIKE 'pass\_%';

COMMIT;
