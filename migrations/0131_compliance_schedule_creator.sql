BEGIN;

-- 0000 creates this table before 0022's CREATE IF NOT EXISTS, so the
-- latter never adds its created_by column on fresh or upgraded databases.
-- Historical creators are unknown; do not invent an actor for old rows.
ALTER TABLE compliance_schedules ADD COLUMN IF NOT EXISTS created_by text;

COMMIT;
