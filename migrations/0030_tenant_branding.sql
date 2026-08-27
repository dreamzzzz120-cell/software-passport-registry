BEGIN;

-- Persistent white-label branding. Until now the only white-label capability
-- was ReportsView's "White-label client report" export, which asks the user
-- to retype the MSP name/logo/color into local component state every single
-- time (nothing is saved). This table is the smallest addition that lets a
-- tenant set its branding once; it does not itself change what a report
-- contains -- generateCoBrandedTrustReport already only uses the client's
-- already-loaded software inventory and real score/compliance data, so
-- persisting the branding inputs carries no scoring-fabrication risk.
CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id text PRIMARY KEY,
  company_name text,
  brand_color text,
  logo_data_url text,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by text
);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_branding' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON tenant_branding USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_branding TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_branding TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
