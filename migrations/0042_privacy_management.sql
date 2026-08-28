BEGIN;

-- Privacy Management System, Increment A of the Governance & Compliance
-- roadmap (docs/governance-compliance-inventory.md). Reuses the exact
-- tenant-scoping/RLS pattern established for Governance Tier-1
-- (migrations/0041) -- no new architecture invented. Client-specific
-- (client_id nullable, matching the existing questionnaires/vendors
-- pattern of an MSP-wide record when null).
--
-- Deliberately NOT included here: automatic legal-compliance
-- determination (there is none, anywhere in this schema or the routes
-- built on it -- decisions are recorded as made by a named reviewer, never
-- inferred), and a formal link to Incident Management, which does not
-- exist yet (Increment C) -- privacy_impact_assessments carries a loosely
-- coupled, nullable related_incident_id text column (matching the
-- related_control_ids-style loose coupling used throughout this schema)
-- so Increment C can wire a real incidents table to it without another
-- migration touching this table.

CREATE TABLE IF NOT EXISTS privacy_information_inventory (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text,
  information_type text NOT NULL,
  category text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  use_description text NOT NULL DEFAULT '',
  disclosure_recipients text NOT NULL DEFAULT '',
  geography text NOT NULL DEFAULT '',
  retention text NOT NULL DEFAULT '',
  disposal text NOT NULL DEFAULT '',
  access_roles text NOT NULL DEFAULT '',
  owner_name text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS privacy_inventory_tenant_idx ON privacy_information_inventory (tenant_id, client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text,
  requestor_name text NOT NULL,
  requestor_email text NOT NULL DEFAULT '',
  request_type text NOT NULL CHECK (request_type IN ('ACCESS','CORRECTION','DELETION','PORTABILITY','OBJECTION','OTHER')),
  scope text NOT NULL DEFAULT '',
  received_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','IN_PROGRESS','COMPLETED','REJECTED','WITHDRAWN')),
  response text NOT NULL DEFAULT '',
  evidence_ids text NOT NULL DEFAULT '[]',
  completed_at timestamp,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- "Completion" (a real, meaningful state transition) requires the actual
  -- completion fact to be recorded together, not left implicit.
  CHECK (status != 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS privacy_requests_tenant_idx ON privacy_requests (tenant_id, status, received_at DESC);

CREATE TABLE IF NOT EXISTS privacy_impact_assessments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text,
  processing_description text NOT NULL DEFAULT '',
  personal_information_description text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  risks text NOT NULL DEFAULT '',
  safeguards text NOT NULL DEFAULT '',
  residual_risk text CHECK (residual_risk IS NULL OR residual_risk IN ('LOW','MEDIUM','HIGH')),
  related_incident_id text,
  reviewer_name text,
  decision text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','APPROVED','REQUIRES_CHANGES','REJECTED')),
  decided_at timestamp,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A real decision (anything but PENDING) requires an actual named
  -- reviewer and a decision timestamp -- SPR never infers who decided.
  CHECK (decision = 'PENDING' OR (reviewer_name IS NOT NULL AND reviewer_name != '' AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS privacy_pia_tenant_idx ON privacy_impact_assessments (tenant_id, decision, updated_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['privacy_information_inventory','privacy_requests','privacy_impact_assessments']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'spr_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_information_inventory, privacy_requests, privacy_impact_assessments TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_information_inventory, privacy_requests, privacy_impact_assessments TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
