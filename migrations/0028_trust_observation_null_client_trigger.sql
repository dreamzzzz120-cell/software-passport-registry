BEGIN;

-- Real production bug, found via live testing: spr_enforce_trust_observation_integrity
-- (0009_authoritative_integrity_and_event_guards) checks
--   IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id)
-- with no guard for NEW.client_id IS NULL. A NULL client_id never equals any
-- real client id, so this raised "Trust observation client does not belong
-- to tenant" for every client-less passport (a real, supported state --
-- migration 0027 made client_id nullable on this exact table for exactly
-- this reason). The sibling checks in this SAME migration file already
-- handle this correctly (collector_results: "p.client_id IS NULL OR
-- p.client_id = NEW.client_id"; alert_subscriptions: "NEW.client_id IS NOT
-- NULL AND NOT EXISTS (...)"). This trigger was simply missed.
--
-- Combined with 0027 and the ON CONFLICT column-list fix in
-- src/trust/trust-loop.ts (deployed alongside this migration), this closes
-- out every layer that was rejecting trust_observations inserts for a
-- client-less passport: zero rows had ever been successfully inserted into
-- trust_observations in production before this fix, for any tenant, any
-- passport, any provider.

CREATE OR REPLACE FUNCTION spr_enforce_trust_observation_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_record record;
BEGIN
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

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
