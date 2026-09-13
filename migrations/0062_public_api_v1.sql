BEGIN;

-- Public API v1 uses the existing tenant-scoped API-key table. This migration
-- only adds lookup indexes needed for high-volume verification traffic.
CREATE INDEX IF NOT EXISTS spr_api_keys_hash_active
  ON spr_api_keys (key_hash, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS spr_api_keys_last_used
  ON spr_api_keys (tenant_id, last_used_at DESC);

COMMIT;
