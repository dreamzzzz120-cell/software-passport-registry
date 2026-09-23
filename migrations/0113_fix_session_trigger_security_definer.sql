BEGIN;

-- Runtime-role/RLS fix for integrity triggers used by the authenticated HTTP
-- request transaction. These triggers validate cross-table tenant ownership;
-- that validation must not be blocked by the caller's row visibility policy.
-- The write itself remains protected by RLS on the target table.
CREATE OR REPLACE FUNCTION spr_enforce_user_session_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = NEW.user_id
      AND u.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'User session does not belong to the referenced user''s tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_user_session_integrity ON user_sessions;
CREATE TRIGGER spr_user_session_integrity
BEFORE INSERT OR UPDATE ON user_sessions
FOR EACH ROW EXECUTE FUNCTION spr_enforce_user_session_integrity();

CREATE OR REPLACE FUNCTION spr_enforce_login_history_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';
  END IF;
  -- DELETE is required for explicit tenant/workspace erasure. The
  -- immutability rule applies to history mutation, not retention policy.
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.workspace_deletion', true) IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'LOGIN_HISTORY_DELETE_NOT_AUTHORIZED';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = NEW.user_id
      AND u.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Login history entry does not belong to the referenced user''s tenant';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_login_history_integrity ON login_history;
CREATE TRIGGER spr_login_history_integrity
BEFORE INSERT OR UPDATE OR DELETE ON login_history
FOR EACH ROW EXECUTE FUNCTION spr_enforce_login_history_integrity();

CREATE OR REPLACE FUNCTION spr_enforce_client_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('client_limit:' || NEW.tenant_id));

  SELECT client_limit
    INTO v_limit
    FROM tenant_subscriptions
   WHERE tenant_id = NEW.tenant_id;

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO v_count
    FROM clients
   WHERE tenant_id = NEW.tenant_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'CLIENT_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_client_limit_guard ON clients;
CREATE TRIGGER spr_client_limit_guard
BEFORE INSERT ON clients
FOR EACH ROW EXECUTE FUNCTION spr_enforce_client_limit();

COMMIT;
