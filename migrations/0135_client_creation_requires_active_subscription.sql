BEGIN;

-- Defense-in-depth paywall at the database mutation boundary.
-- A client row may be inserted only for a tenant with a positively confirmed
-- active paid plan. Missing rows, incomplete checkout, trialing, past_due,
-- canceled, or unpaid states all fail closed. Enterprise remains unlimited
-- only after that active-plan proof succeeds.
CREATE OR REPLACE FUNCTION spr_enforce_client_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_limit integer;
  v_count integer;
  v_plan text;
  v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('client_limit:' || NEW.tenant_id));

  SELECT client_limit, plan, status
    INTO v_limit, v_plan, v_status
  FROM tenant_subscriptions
  WHERE tenant_id = NEW.tenant_id
  LIMIT 1;

  IF NOT FOUND OR v_plan IS NULL OR v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count FROM clients WHERE tenant_id = NEW.tenant_id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'CLIENT_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
