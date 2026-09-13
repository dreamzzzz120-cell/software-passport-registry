BEGIN;

-- White-label custom domains. One row per hostname a tenant has asked to
-- serve its workspace from. The hostname is registered with the hosting
-- provider (Vercel project domains API) when the row is created, the DNS
-- records the provider requires are stored in verification_json for the
-- Owner to create, and status moves to 'active' only after the provider
-- reports the domain verified and correctly configured. Nothing here is
-- assumed: status is what the provider last said, at last_checked_at.
CREATE TABLE IF NOT EXISTS tenant_custom_domains (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  hostname text NOT NULL,
  status text NOT NULL DEFAULT 'pending_dns'
    CHECK (status IN ('pending_dns', 'active', 'error')),
  provider text NOT NULL DEFAULT 'vercel' CHECK (provider = 'vercel'),
  -- DNS records the customer must create, exactly as the provider returned
  -- them, plus the CNAME/A target for the hostname itself.
  verification_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Whether the hostname is on the identity provider's authorized-domain
  -- list, so that sign-in (including Google sign-in) works on it. Kept
  -- separate from status: a domain can serve pages while sign-in on it is
  -- still blocked, and the UI must say which.
  sign_in_enabled boolean NOT NULL DEFAULT false,
  sign_in_error text,
  last_checked_at timestamp,
  last_error text,
  activated_at timestamp,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_custom_domains_hostname_idx ON tenant_custom_domains (lower(hostname));
CREATE INDEX IF NOT EXISTS tenant_custom_domains_tenant_idx ON tenant_custom_domains (tenant_id, created_at DESC);

ALTER TABLE tenant_custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_custom_domains FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_custom_domains' AND policyname = 'spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON tenant_custom_domains
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_custom_domains TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
