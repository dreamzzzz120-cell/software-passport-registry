BEGIN;

-- Widens the commercial plan model from 3 tiers (starter/growth/enterprise)
-- to the 5-tier structure (pilot/starter/professional/growth/enterprise).
-- Extends the existing tenant_subscriptions table (migration 0031) rather
-- than creating a second billing/subscription system.
ALTER TABLE tenant_subscriptions DROP CONSTRAINT IF EXISTS tenant_subscriptions_plan_check;
ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_plan_check
  CHECK (plan IN ('pilot', 'starter', 'professional', 'growth', 'enterprise'));

-- Concurrency-safe client-limit enforcement at the database level (per the
-- spec's own rule: "the database/application must enforce limits... use
-- transactional enforcement where necessary"). A plain application-level
-- check-then-insert has a real race window between two simultaneous
-- requests both reading the same COUNT before either commits. This trigger
-- closes that window with a per-tenant advisory transaction lock (blocks a
-- concurrent second INSERT for the same tenant until the first commits or
-- rolls back), then re-checks the count against the tenant's real,
-- current client_limit. A tenant with no tenant_subscriptions row, or a
-- row with a NULL client_limit, is treated as unrestricted -- see
-- docs/billing-paywall-inventory.md for why retroactively restricting
-- every pre-existing tenant would be wrong.
CREATE OR REPLACE FUNCTION spr_enforce_client_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('client_limit:' || NEW.tenant_id));
  SELECT client_limit INTO v_limit FROM tenant_subscriptions WHERE tenant_id = NEW.tenant_id;
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
DROP TRIGGER IF EXISTS spr_client_limit_guard ON clients;
CREATE TRIGGER spr_client_limit_guard BEFORE INSERT ON clients
FOR EACH ROW EXECUTE FUNCTION spr_enforce_client_limit();

COMMIT;
