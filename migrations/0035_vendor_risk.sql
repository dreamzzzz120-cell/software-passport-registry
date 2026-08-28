BEGIN;

-- Vendor Risk module: VendorsView.tsx has existed since earlier this session
-- as a fully-built UI (search/filter/sort, drilldown, audit ledger) wired to
-- nothing -- App.tsx's `vendors` state is permanently EMPTY_VENDORS and
-- handleAddAuditAttestation only ever mutated local React state, silently
-- lost on refresh. This is the real backing store: a vendor is the MSP's
-- own supply-chain dependency (their RMM vendor, backup provider, etc.) --
-- the inverse relationship of `clients` (companies the MSP serves).
CREATE TABLE IF NOT EXISTS vendors (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Software Publisher',
  website text NOT NULL DEFAULT '',
  locations text NOT NULL DEFAULT '',
  review_status text NOT NULL DEFAULT 'Under Review' CHECK (review_status IN ('Approved','Under Review','Blocked')),
  risk_tier text NOT NULL DEFAULT 'Medium' CHECK (risk_tier IN ('Low','Medium','High')),
  -- Both start at a real, disclosed default (70 = 'Medium' by the same
  -- thresholds the audit-scoring below uses) rather than a fabricated
  -- perfect or zero score for a vendor nothing has been recorded about yet.
  reputation_score integer NOT NULL DEFAULT 70 CHECK (reputation_score BETWEEN 0 AND 100),
  overall_trust_score integer NOT NULL DEFAULT 70 CHECK (overall_trust_score BETWEEN 0 AND 100),
  active_passports_count integer NOT NULL DEFAULT 0,
  security_incidents_count integer NOT NULL DEFAULT 0,
  last_audit_date text,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

-- An append-only ledger of audit attestations lodged against a vendor --
-- the UI already calls the action "Lock into Ledger" and disables editing
-- once submitted, so the backend enforces that intent for real instead of
-- just implying it.
CREATE TABLE IF NOT EXISTS vendor_audits (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  vendor_id text NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  audit_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('Passed','Failed','Under Review')),
  details text NOT NULL DEFAULT '',
  auditor text NOT NULL,
  reference_hash text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS vendor_audits_vendor_idx ON vendor_audits (tenant_id, vendor_id, created_at DESC);

CREATE OR REPLACE FUNCTION spr_enforce_vendor_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VENDOR_AUDIT_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id = NEW.vendor_id AND v.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Vendor audit does not belong to the referenced vendor''s tenant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_vendor_audit_immutable ON vendor_audits;
CREATE TRIGGER spr_vendor_audit_immutable BEFORE INSERT OR UPDATE OR DELETE ON vendor_audits
FOR EACH ROW EXECUTE FUNCTION spr_enforce_vendor_audit_immutable();

DO $$
BEGIN
  EXECUTE 'ALTER TABLE vendors ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vendors' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON vendors USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
  EXECUTE 'ALTER TABLE vendor_audits ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vendor_audits' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON vendor_audits USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO spr_app_runtime;
    GRANT SELECT, INSERT ON vendor_audits TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO spr_worker_runtime;
    GRANT SELECT, INSERT ON vendor_audits TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
