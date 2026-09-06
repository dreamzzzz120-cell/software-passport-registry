-- 0072: Corrects a type-mismatch bug in migration 0064's Active Passport
-- entitlement guard. monitoring_configurations.enabled is integer (0/1), not
-- boolean (migrations/0000_base_application_schema.sql, src/db/schema.ts).
-- Migration 0064 compared it against the literal `true` in both a partial
-- index predicate and the trigger function body. Postgres has no implicit
-- integer<->boolean cast, so `enabled = true` fails immediately with
-- "operator does not exist: integer = boolean" -- reproduced by running the
-- full migration history against a brand-new Postgres 16 instance from
-- scratch. This migration re-creates the index and function with correct
-- integer comparisons. It is safe to run whether or not this environment's
-- 0064 already succeeded some other way: CREATE INDEX IF NOT EXISTS and
-- CREATE OR REPLACE FUNCTION make this idempotent, and the trigger logic
-- itself is unchanged -- only the type of literal it compares against.

BEGIN;

DROP INDEX IF EXISTS idx_monitoring_active_passports;
CREATE INDEX IF NOT EXISTS idx_monitoring_active_passports
  ON monitoring_configurations (tenant_id, passport_id)
  WHERE subject_type = 'integration_provider' AND enabled = 1;

CREATE OR REPLACE FUNCTION spr_enforce_active_passport_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subscription_status text;
  active_limit integer;
  active_count integer;
  passport_already_active boolean;
BEGIN
  IF NEW.enabled IS DISTINCT FROM 1 OR NEW.subject_type IS DISTINCT FROM 'integration_provider' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('spr:active-passports:' || NEW.tenant_id, 0));

  SELECT status, client_limit INTO subscription_status, active_limit
  FROM tenant_subscriptions WHERE tenant_id = NEW.tenant_id LIMIT 1;

  IF subscription_status IS NULL OR subscription_status = 'incomplete' THEN
    RETURN NEW;
  END IF;

  IF subscription_status IN ('active', 'trialing', 'past_due') AND active_limit IS NULL THEN
    RETURN NEW;
  END IF;
  IF subscription_status NOT IN ('active', 'trialing', 'past_due') THEN
    active_limit := 0;
  END IF;

  SELECT COUNT(DISTINCT passport_id)::integer INTO active_count
  FROM monitoring_configurations
  WHERE tenant_id = NEW.tenant_id
    AND subject_type = 'integration_provider'
    AND enabled = 1
    AND id <> NEW.id;

  SELECT EXISTS (
    SELECT 1 FROM monitoring_configurations
    WHERE tenant_id = NEW.tenant_id
      AND subject_type = 'integration_provider'
      AND passport_id = NEW.passport_id
      AND enabled = 1
      AND id <> NEW.id
  ) INTO passport_already_active;

  IF NOT passport_already_active AND active_count >= active_limit THEN
    RAISE EXCEPTION 'ACTIVE_PASSPORT_LIMIT_REACHED:%:%', active_count, active_limit USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_active_passport_limit ON monitoring_configurations;
CREATE TRIGGER spr_active_passport_limit
BEFORE INSERT OR UPDATE OF enabled, passport_id, subject_type ON monitoring_configurations
FOR EACH ROW EXECUTE FUNCTION spr_enforce_active_passport_limit();

COMMIT;
