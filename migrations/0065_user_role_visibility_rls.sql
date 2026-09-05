-- 0065: Restrict tenant-wide user directory visibility by role at the database boundary.
-- The organization/team endpoint is tenant-scoped, but authenticated low-privilege
-- users must not be able to enumerate every member's email and role. Owners,
-- Admins and Operators retain tenant-wide team visibility; every other role can
-- only see its own users row. The policy also preserves self-service profile
-- updates by allowing a principal to access its own row.

BEGIN;

CREATE OR REPLACE FUNCTION spr_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.id = NULLIF(current_setting('app.user_id', true), '')::integer
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION spr_current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spr_current_user_role() TO spr_app_runtime;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spr_tenant_isolation ON public.users;

CREATE POLICY spr_tenant_isolation ON public.users
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    AND (
      spr_current_user_role() IN ('Owner', 'Admin', 'Operator')
      OR id = NULLIF(current_setting('app.user_id', true), '')::integer
    )
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    AND (
      spr_current_user_role() IN ('Owner', 'Admin', 'Operator')
      OR id = NULLIF(current_setting('app.user_id', true), '')::integer
    )
  );

COMMIT;
