-- 0049: Explicit organization/workspace model for multi-tenant provisioning.
-- Backward-compatible: existing users retain tenant_id as the authoritative legacy
-- projection until the application migration is completed.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  owner_user_id UUID,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_one_owner_idx
  ON organization_memberships (organization_id)
  WHERE role = 'OWNER';

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
  ON organization_memberships (user_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_member_isolation ON organizations;
CREATE POLICY organization_member_isolation ON organizations
  USING (EXISTS (
    SELECT 1 FROM organization_memberships m
    WHERE m.organization_id = organizations.id
      AND m.user_id::text = current_setting('app.user_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM organization_memberships m
    WHERE m.organization_id = organizations.id
      AND m.user_id::text = current_setting('app.user_id', true)
  ));

DROP POLICY IF EXISTS organization_membership_isolation ON organization_memberships;
CREATE POLICY organization_membership_isolation ON organization_memberships
  USING (user_id::text = current_setting('app.user_id', true));

CREATE INDEX IF NOT EXISTS organizations_stripe_customer_idx
  ON organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
