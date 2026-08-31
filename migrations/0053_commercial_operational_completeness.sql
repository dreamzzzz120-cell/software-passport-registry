BEGIN;

-- Commercial entitlements, operational lifecycle, retention, exports/storage metadata,
-- notification outbox, canonical RBAC, and deployment-verifiable RLS.

CREATE TABLE IF NOT EXISTS plan_capabilities (
  plan text NOT NULL,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (plan, capability),
  CONSTRAINT plan_capabilities_plan_check CHECK (plan IN ('pilot','starter','professional','growth','enterprise'))
);

INSERT INTO plan_capabilities (plan, capability) VALUES
('pilot','workspace'),('pilot','passport'),('pilot','sbom'),('pilot','vendor_risk'),('pilot','governance'),('pilot','msp'),('pilot','white_label'),('pilot','bulk_export'),
('starter','workspace'),('starter','passport'),('starter','sbom'),
('professional','workspace'),('professional','passport'),('professional','sbom'),('professional','monitoring'),('professional','vendor_risk'),('professional','governance'),('professional','bulk_export'),
('growth','workspace'),('growth','passport'),('growth','sbom'),('growth','monitoring'),('growth','vendor_risk'),('growth','governance'),('growth','msp'),('growth','white_label'),('growth','bulk_export'),('growth','api'),
('enterprise','workspace'),('enterprise','passport'),('enterprise','sbom'),('enterprise','monitoring'),('enterprise','vendor_risk'),('enterprise','governance'),('enterprise','msp'),('enterprise','white_label'),('enterprise','bulk_export'),('enterprise','api'),('enterprise','enterprise_controls')
ON CONFLICT (plan, capability) DO NOTHING;

CREATE TABLE IF NOT EXISTS billing_audit_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  stripe_event_id text,
  plan text,
  status text,
  payload text NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS billing_audit_events_tenant_created_idx ON billing_audit_events (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS billing_audit_events_stripe_event_idx ON billing_audit_events (stripe_event_id) WHERE stripe_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS retention_policies (
  tenant_id text PRIMARY KEY,
  audit_days integer NOT NULL DEFAULT 2555 CHECK (audit_days >= 30),
  evidence_days integer NOT NULL DEFAULT 730 CHECK (evidence_days >= 30),
  notification_days integer NOT NULL DEFAULT 180 CHECK (notification_days >= 30),
  updated_by text,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_deletion_requests (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
  requested_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamp,
  completed_at timestamp,
  error_code text,
  error_message text
);
CREATE INDEX IF NOT EXISTS tenant_deletion_requests_tenant_idx ON tenant_deletion_requests (tenant_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS object_files (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint,
  sha256 text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED','PENDING')),
  created_by text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamp,
  UNIQUE (tenant_id, provider, object_key)
);
CREATE INDEX IF NOT EXISTS object_files_tenant_idx ON object_files (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  destination text NOT NULL,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error text,
  available_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at timestamp
);
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx ON notification_outbox (status, available_at);

-- Canonical application roles. Existing roles are preserved; unknown roles are rejected.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Owner','Admin','Operator','Technician','Viewer','Client'));

-- Every tenant-bearing table must be protected by RLS in every deployment that applies
-- the authoritative migration set. This function is used by readiness/release checks.
CREATE OR REPLACE FUNCTION spr_assert_tenant_rls()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name)
    INTO missing
  FROM information_schema.columns c
  JOIN pg_class r ON r.relname = c.table_name
  JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id'
    AND r.relkind = 'r'
    AND (NOT r.relrowsecurity OR NOT r.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TENANT_RLS_NOT_HARDENED:%', missing;
  END IF;
END;
$$;

-- RLS on the new tenant tables.
ALTER TABLE billing_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON billing_audit_events;
CREATE POLICY spr_tenant_isolation ON billing_audit_events USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON retention_policies;
CREATE POLICY spr_tenant_isolation ON retention_policies USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE tenant_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_deletion_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON tenant_deletion_requests;
CREATE POLICY spr_tenant_isolation ON tenant_deletion_requests USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE object_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON object_files;
CREATE POLICY spr_tenant_isolation ON object_files USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON notification_outbox;
CREATE POLICY spr_tenant_isolation ON notification_outbox USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON plan_capabilities TO spr_app_runtime;
    GRANT SELECT, INSERT ON billing_audit_events TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON retention_policies TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON tenant_deletion_requests TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON object_files TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON notification_outbox TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT ON plan_capabilities TO spr_worker_runtime;
    GRANT SELECT, INSERT ON billing_audit_events TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON retention_policies TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE ON tenant_deletion_requests TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE ON object_files TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON notification_outbox TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
