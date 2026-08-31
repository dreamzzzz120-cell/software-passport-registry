-- 0051: Atomic, authenticated organization provisioning primitive.
-- The caller cannot choose an arbitrary tenant: the owner is derived from the
-- database session's authenticated app.user_id and must match the requested user.

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

  IF EXISTS (
    SELECT 1 FROM public.organization_memberships m WHERE m.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'ORGANIZATION_OWNER_ALREADY_PROVISIONED';
  END IF;

  INSERT INTO public.organizations (name, owner_user_id)
  VALUES (btrim(p_name), v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'OWNER');

  UPDATE public.organizations
  SET updated_at = now()
  WHERE id = v_org_id;

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION provision_organization(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_organization(text, integer) TO spr_app_runtime;

COMMIT;
