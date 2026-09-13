BEGIN;

-- 1. Orphaned developer-productivity tables (app_users / projects / tasks /
-- snippets / work_sessions) are NOT dropped here: the release gate rejects
-- table drops inside migrations so that destructive changes get explicit review.
-- scripts/drop-orphan-developer-tables.ts performs the drop as a reviewed,
-- one-off operation and refuses if any of the tables holds a row.

-- 2. Public contact form (/contact/). Rows belong to the system tenant, the
-- same one Free Review and distribution use, so RLS applies and the founder
-- surface reads them through the ordinary scoped path.
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  topic text NOT NULL CHECK (topic IN ('product', 'security', 'compliance', 'partnership', 'msp_pilot', 'privacy', 'other')),
  message text NOT NULL,
  ip_hash text NOT NULL,
  user_agent text,
  forwarded_at timestamp,
  forward_error text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contact_inquiries_created_idx ON contact_inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_inquiries_ip_created_idx ON contact_inquiries (ip_hash, created_at DESC);

ALTER TABLE contact_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_inquiries FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contact_inquiries' AND policyname = 'spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON contact_inquiries
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contact_inquiries' AND policyname = 'spr_worker_cross_tenant') THEN
    CREATE POLICY spr_worker_cross_tenant ON contact_inquiries FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END $$;

-- 3. Data Processing Agreement executions.
CREATE TABLE IF NOT EXISTS tenant_dpa_executions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  document_version text NOT NULL,
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  customer_legal_name text NOT NULL,
  signatory_name text NOT NULL,
  signatory_title text NOT NULL,
  signatory_email text NOT NULL,
  signatory_uid text NOT NULL,
  ip_hash text NOT NULL,
  user_agent text,
  executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS tenant_dpa_executions_tenant_idx ON tenant_dpa_executions (tenant_id, executed_at DESC);

ALTER TABLE tenant_dpa_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_dpa_executions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_dpa_executions' AND policyname = 'spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON tenant_dpa_executions
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON contact_inquiries TO spr_app_runtime;
    GRANT SELECT, INSERT ON tenant_dpa_executions TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, DELETE ON contact_inquiries TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
