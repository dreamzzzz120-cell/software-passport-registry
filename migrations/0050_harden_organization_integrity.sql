-- 0050: Harden the explicit organization model before application cutover.
-- The base users.id is serial, so organization references must use integer IDs.
-- This migration is additive/idempotent and intentionally does not touch legacy
-- tenant_id authorization until the application layer is migrated.

BEGIN;

-- 0049 initially declared UUID user references. SPR users use serial IDs.
-- The provisioning tables are new and must use the existing authoritative user PK.
ALTER TABLE organizations
  ALTER COLUMN owner_user_id TYPE integer
  USING owner_user_id::text::integer;

ALTER TABLE organization_memberships
  ALTER COLUMN user_id TYPE integer
  USING user_id::text::integer;

-- Authoritative referential integrity: a membership/owner must point to a real user.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_owner_user_fk'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_owner_user_fk
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_memberships_user_fk'
      AND conrelid = 'organization_memberships'::regclass
  ) THEN
    ALTER TABLE organization_memberships
      ADD CONSTRAINT organization_memberships_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- A user has exactly one workspace in the current SPR authorization model.
CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_one_org_per_user_idx
  ON organization_memberships (user_id);

-- The recorded owner must be the OWNER membership. This prevents an org from
-- naming an unrelated user as owner while still claiming a valid membership.
CREATE OR REPLACE FUNCTION enforce_organization_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships m
    WHERE m.organization_id = NEW.id
      AND m.user_id = NEW.owner_user_id
      AND m.role = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'ORGANIZATION_OWNER_MEMBERSHIP_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_owner_membership_guard ON organizations;
CREATE CONSTRAINT TRIGGER organizations_owner_membership_guard
AFTER INSERT OR UPDATE OF owner_user_id ON organizations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_organization_owner_membership();

-- Keep membership roles constrained to the supported RBAC set and prevent an
-- existing owner from being silently demoted while organizations.owner_user_id
-- still points at them.
CREATE OR REPLACE FUNCTION enforce_organization_role_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_owner integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role = 'OWNER' AND NEW.role <> 'OWNER' THEN
    SELECT owner_user_id INTO current_owner
    FROM organizations WHERE id = NEW.organization_id;
    IF current_owner = OLD.user_id THEN
      RAISE EXCEPTION 'ORGANIZATION_OWNER_CANNOT_BE_DEMOTED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_membership_role_guard ON organization_memberships;
CREATE TRIGGER organization_membership_role_guard
BEFORE UPDATE OF role, user_id ON organization_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_organization_role_integrity();

-- Security-definer membership check avoids recursive RLS evaluation while
-- keeping callers unable to bypass the organization membership boundary.
CREATE OR REPLACE FUNCTION is_organization_admin(p_organization_id uuid, p_user_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_user_id
      AND m.role IN ('OWNER','ADMIN')
  );
$$;

REVOKE ALL ON FUNCTION is_organization_admin(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_organization_admin(uuid, integer) TO spr_app_runtime;

-- Members may see their own membership; owners/admins may administer memberships
-- within their own organization. No tenant context continues to fail closed.
DROP POLICY IF EXISTS organization_membership_isolation ON organization_memberships;
CREATE POLICY organization_membership_isolation ON organization_memberships
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::integer
    OR is_organization_admin(
      organization_id,
      NULLIF(current_setting('app.user_id', true), '')::integer
    )
  )
  WITH CHECK (
    is_organization_admin(
      organization_id,
      NULLIF(current_setting('app.user_id', true), '')::integer
    )
  );

-- Organization rows are visible only to members of that organization.
DROP POLICY IF EXISTS organization_member_isolation ON organizations;
CREATE POLICY organization_member_isolation ON organizations
  USING (
    EXISTS (
      SELECT 1
      FROM organization_memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
    )
  )
  WITH CHECK (
    is_organization_admin(
      id,
      NULLIF(current_setting('app.user_id', true), '')::integer
    )
  );

COMMIT;
