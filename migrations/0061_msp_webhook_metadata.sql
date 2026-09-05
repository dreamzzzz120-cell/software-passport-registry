BEGIN;

-- MSP webhook management metadata. The original webhook table intentionally
-- kept only delivery/security state; these nullable additions make the
-- management API able to give operators a stable display name and mutation
-- timestamp without changing the existing delivery contract.
ALTER TABLE spr_webhooks ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE spr_webhooks ADD COLUMN IF NOT EXISTS updated_at text;

UPDATE spr_webhooks
SET name = COALESCE(NULLIF(name, ''), 'Webhook ' || left(id, 12)),
    updated_at = COALESCE(updated_at, created_at)
WHERE name IS NULL OR name = '' OR updated_at IS NULL;

ALTER TABLE spr_webhooks ALTER COLUMN name SET DEFAULT 'SPR Webhook';
ALTER TABLE spr_webhooks ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP::text;

COMMIT;
