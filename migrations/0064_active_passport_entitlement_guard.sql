BEGIN;

-- Active Passport is the MSP billing unit: a unique passport with at least one
-- enabled integration-monitoring configuration. The existing plan client_limit
-- is reused as the included Active Passport allowance so billing semantics stay
-- compatible with already-issued Stripe plans while the public meter moves from
-- "clients" to the actually monitored assets.
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
  IF NEW.enabled IS DISTINCT FROM true OR NEW.subject_type IS DISTINCT FROM 'integration_provider' THEN
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
    AND enabled = true
    AND id <> NEW.id;

  SELECT EXISTS (
    SELECT 1 FROM monitoring_configurations
    WHERE tenant_id = NEW.tenant_id
      AND subject_type = 'integration_provider'
      AND passport_id = NEW.passport_id
      AND enabled = true
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
