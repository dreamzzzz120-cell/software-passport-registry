BEGIN;

-- The base schema can create compliance_schedules before the later CREATE IF NOT EXISTS
-- definition that includes created_by. Add the column explicitly and preserve UNKNOWN
-- for historical creator identity rather than inventing an actor.
ALTER TABLE compliance_schedules ADD COLUMN IF NOT EXISTS created_by text;

COMMIT;
