-- 0052: Complete the supported first-workspace provisioning transition.
-- The authenticated user's existing legacy tenant projection is moved to the
-- newly-created organization atomically by the SECURITY DEFINER provisioning
-- function. The function remains bound to app.user_id and never trusts a
-- caller-supplied tenant identifier.

BEGIN;

CREATE OR REPLACE FUNCTION provision_organization(
  p_name text,
  p_owner_user_id integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_user_id integer;
BEGIN
  v_user_id := NULLIF(current_setting('app.user_id', true), '')::integer;

  IF v_user_id IS NULL OR p_owner_user_id IS NULL OR p_owner_user_id <> v_user_id THEN
    RAISE EXCEPTION 'ORGANIZATION_OWNER_CONTEXT_MISMATCH';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(btrim(p_name)) > 120 THEN
    RAISE EXCEPTION 'ORGANIZATION_NAME_INVALID';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_OWNER_NOT_FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = v_user_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_OWNER_ALREADY_PROVISIONED';
  END IF;

  INSERT INTO public.organizations (name, owner_user_id)
  VALUES (btrim(p_name), v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'OWNER');

  -- Cut the authenticated user over from the legacy tenant projection to the
  -- authoritative organization id in the same transaction as provisioning.
  UPDATE public.users
  SET tenant_id = v_org_id::text
  WHERE id = v_user_id;

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION provision_organization(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_organization(text, integer) TO spr_app_runtime;

COMMIT;
