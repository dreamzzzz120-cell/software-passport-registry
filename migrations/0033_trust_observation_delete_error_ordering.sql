BEGIN;

-- Real production bug, found via live testing: spr_trust_observation_integrity
-- fires BEFORE INSERT OR UPDATE OR DELETE, and the function intentionally
-- rejects UPDATE/DELETE at the end with a clear TRUST_OBSERVATION_IMMUTABLE
-- error (trust_observations is a deliberately immutable audit ledger -- this
-- part is correct and unchanged). But every check ahead of that guard reads
-- NEW.passport_id / NEW.tenant_id / NEW.client_id, and NEW is NULL for a
-- DELETE. Postgres evaluates "column = NULL" as NULL (never true), so the
-- very first check's EXISTS(...) always comes back false for a DELETE,
-- raising the misleading "Trust observation passport does not belong to
-- tenant" instead of the intended TRUST_OBSERVATION_IMMUTABLE -- confirmed
-- live: attempting to delete a trust_observations row always failed with
-- the wrong error, for any row, regardless of its actual tenant/passport.
-- Moving the TG_OP guard to the top fixes the error message without
-- changing the behavior at all: DELETE and UPDATE were always rejected
-- either way, this only fixes what they're rejected WITH.

CREATE OR REPLACE FUNCTION spr_enforce_trust_observation_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_record record;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM passports p WHERE p.id = NEW.passport_id AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Trust observation passport does not belong to tenant';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Trust observation client does not belong to tenant';
  END IF;
  IF NEW.observation_version < 1 THEN
    RAISE EXCEPTION 'Trust observation version must be positive';
  END IF;

  IF NEW.previous_observation_id IS NULL THEN
    IF NEW.observation_version <> 1 THEN
      RAISE EXCEPTION 'First trust observation must have version 1';
    END IF;
  ELSE
    SELECT id, tenant_id, passport_id, observation_version
      INTO previous_record
      FROM trust_observations
     WHERE id = NEW.previous_observation_id;
    IF previous_record.id IS NULL
       OR previous_record.tenant_id <> NEW.tenant_id
       OR previous_record.passport_id <> NEW.passport_id
       OR NEW.observation_version <> previous_record.observation_version + 1 THEN
      RAISE EXCEPTION 'Trust observation chain is invalid';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
