BEGIN;
CREATE TABLE IF NOT EXISTS client_service_quotes (
 id text PRIMARY KEY,
 tenant_id text NOT NULL,
 client_id text NOT NULL,
 passport_id text NOT NULL,
 service_name text NOT NULL,
 scope text NOT NULL,
 deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
 evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
 currency text NOT NULL DEFAULT 'CAD' CHECK (currency='CAD'),
 amount_cents integer NOT NULL CHECK (amount_cents>=0),
 status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OFFERED','APPROVED','DECLINED','CANCELLED')),
 created_by text NOT NULL,
 decided_by text,
 decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_service_quotes_client_idx ON client_service_quotes(tenant_id,client_id,created_at DESC);
ALTER TABLE client_service_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_service_quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON client_service_quotes;
CREATE POLICY spr_tenant_isolation ON client_service_quotes
 FOR ALL TO spr_app_runtime
 USING (tenant_id=current_setting('app.tenant_id',true))
 WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON client_service_quotes TO spr_app_runtime;
COMMIT;
