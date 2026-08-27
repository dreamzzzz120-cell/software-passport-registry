BEGIN;

-- MSP customer/tenant mapping. Nothing in the existing schema represents
-- "which of the MSP's downstream customers does this connected provider
-- manage" -- integration_credentials (migration 0013) models one connection
-- per (tenant, provider), and clients has no link back to any provider.
-- This table is the smallest addition that bridges them: a connected
-- provider's real customer/company/organization list, each row optionally
-- mapped to an SPR client owned by the same tenant.
--
-- discovery never writes trust scores or evidence -- it only records who the
-- provider says its customers are. Software/evidence for a mapped customer
-- still flows through the same evidence_items -> canonical scoring engine
-- path as everything else.
CREATE TABLE IF NOT EXISTS provider_customers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  external_customer_id text NOT NULL,
  external_customer_name text NOT NULL,
  client_id text REFERENCES clients(id) ON DELETE SET NULL,
  raw_metadata text NOT NULL DEFAULT '{}',
  discovered_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mapped_at timestamp,
  mapped_by text,
  UNIQUE (tenant_id, provider, external_customer_id)
);
CREATE INDEX IF NOT EXISTS provider_customers_tenant_idx ON provider_customers (tenant_id, provider);
CREATE INDEX IF NOT EXISTS provider_customers_client_idx ON provider_customers (client_id);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE provider_customers ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_customers' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON provider_customers USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON provider_customers TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON provider_customers TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
