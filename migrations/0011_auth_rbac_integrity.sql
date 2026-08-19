BEGIN;

-- Authentication/RBAC hardening.
-- Existing rows are validated before constraints are installed. Migration fails closed
-- rather than silently coercing an invalid identity, tenant, or role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE uid IS NULL OR btrim(uid) = '' OR length(uid) > 256) THEN
    RAISE EXCEPTION 'Invalid user UID prevents authentication hardening';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE tenant_id IS NULL OR btrim(tenant_id) = '' OR tenant_id = 'tenant-default' OR length(tenant_id) > 256) THEN
    RAISE EXCEPTION 'Invalid/default tenant assignment prevents RBAC hardening';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE role IS NULL OR role NOT IN ('Owner','Admin','Technician','Viewer','Client')) THEN
    RAISE EXCEPTION 'Invalid user role prevents RBAC hardening';
  END IF;
END $$;

ALTER TABLE users ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;

ALTER TABLE users
  ADD CONSTRAINT users_uid_nonempty_ck CHECK (length(btrim(uid)) BETWEEN 1 AND 256),
  ADD CONSTRAINT users_tenant_nonempty_ck CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 256 AND tenant_id <> 'tenant-default'),
  ADD CONSTRAINT users_role_ck CHECK (role IN ('Owner','Admin','Technician','Viewer','Client'));

CREATE INDEX IF NOT EXISTS users_tenant_idx ON users (tenant_id);
CREATE INDEX IF NOT EXISTS users_tenant_role_idx ON users (tenant_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_unique_idx ON users (tenant_id, lower(btrim(email)));

-- Prevent cross-tenant references for the security-critical identity graph.
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON spr_api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS webhooks_tenant_idx ON spr_webhooks (tenant_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_idx ON spr_webhook_deliveries (tenant_id);

COMMIT;
