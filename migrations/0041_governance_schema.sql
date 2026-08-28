BEGIN;

-- Governance & Compliance System, Tier 1: the foundational schema layer
-- (Policy Registry, Control Library, Framework/Requirement engine, Risk
-- Register, Control Testing, and a non-destructive governance disposition
-- layer over the existing trust_findings evidence ledger).
--
-- Deliberate design decision, per the governance spec's own rule ("Do NOT
-- weaken existing evidence rules... Do not break existing functionality"):
-- trust_findings.status stays exactly OPEN/UNKNOWN/RESOLVED, driven only by
-- real evidence, unchanged. A governance judgment like "accepted risk" or
-- "false positive" is a human decision ABOUT a finding, not a reinterpretation
-- of the evidence -- so it lives in a separate finding_dispositions table
-- rather than widening trust_findings' status enum. The finding's real
-- evidence-derived status is never overwritten by a governance opinion.

CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  policy_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  owner_name text NOT NULL DEFAULT '',
  version text NOT NULL DEFAULT '0.1',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','ACTIVE','RETIRED')),
  effective_date date,
  review_date date,
  approval_status text NOT NULL DEFAULT 'NOT_APPROVED' CHECK (approval_status IN ('NOT_APPROVED','APPROVED')),
  approver_name text,
  approved_at timestamp,
  related_control_ids text NOT NULL DEFAULT '[]',
  related_requirement_ids text NOT NULL DEFAULT '[]',
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, policy_key)
);
CREATE INDEX IF NOT EXISTS policies_tenant_idx ON policies (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS controls (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  control_key text NOT NULL,
  name text NOT NULL,
  objective text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  owner_name text NOT NULL DEFAULT '',
  frequency text NOT NULL DEFAULT '',
  implementation_status text NOT NULL DEFAULT 'NOT_IMPLEMENTED' CHECK (implementation_status IN ('NOT_IMPLEMENTED','IMPLEMENTED','TESTING','VERIFIED','FAILED','NEEDS_REVIEW','NOT_APPLICABLE')),
  evidence_requirements text NOT NULL DEFAULT '',
  testing_method text NOT NULL DEFAULT '',
  last_tested_at timestamp,
  next_test_due_at timestamp,
  related_policy_ids text NOT NULL DEFAULT '[]',
  related_risk_ids text NOT NULL DEFAULT '[]',
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, control_key)
);
CREATE INDEX IF NOT EXISTS controls_tenant_idx ON controls (tenant_id, implementation_status, updated_at DESC);

-- Global framework/requirement catalog -- NOT tenant-scoped, because a
-- framework's own identity (its name/version) is an objective external fact,
-- the same for every tenant. Deliberately seeded with catalog identity only
-- (name, version, publishing body) -- NEVER with actual requirement text,
-- which this migration does not invent. Every framework starts in
-- REQUIRES_SOURCE_VERIFICATION and stays there until an authorized admin
-- attaches a real, citable source for its requirements.
CREATE TABLE IF NOT EXISTS compliance_frameworks (
  id text PRIMARY KEY,
  framework_key text NOT NULL UNIQUE,
  name text NOT NULL,
  version text NOT NULL,
  published_by text NOT NULL DEFAULT '',
  source_url text,
  status text NOT NULL DEFAULT 'REQUIRES_SOURCE_VERIFICATION' CHECK (status IN ('REQUIRES_SOURCE_VERIFICATION','SOURCED')),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compliance_requirements (
  id text PRIMARY KEY,
  framework_id text NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  requirement_text text NOT NULL DEFAULT '',
  authoritative_source text,
  jurisdiction text NOT NULL DEFAULT '',
  applicability text NOT NULL DEFAULT '',
  -- REQUIRES_SOURCE_VERIFICATION until an admin who has actually read the
  -- framework's own published text confirms requirement_text/
  -- authoritative_source are accurate -- this table is never auto-populated
  -- with generated or remembered requirement language.
  status text NOT NULL DEFAULT 'REQUIRES_SOURCE_VERIFICATION' CHECK (status IN ('REQUIRES_SOURCE_VERIFICATION','VERIFIED_SOURCE')),
  review_date date,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (framework_id, requirement_key),
  CHECK (status = 'REQUIRES_SOURCE_VERIFICATION' OR (authoritative_source IS NOT NULL AND authoritative_source != ''))
);

-- A tenant's own self-assessment of how their controls address a given
-- requirement. Kept separate from the objective requirement text above so a
-- tenant's opinion about their own posture can never be confused with, or
-- silently promoted into, the requirement's authoritative definition.
CREATE TABLE IF NOT EXISTS tenant_requirement_mappings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  requirement_id text NOT NULL REFERENCES compliance_requirements(id) ON DELETE CASCADE,
  related_control_ids text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('SUPPORTED','PARTIAL','NOT_SUPPORTED','UNKNOWN','NEEDS_REVIEW')),
  notes text NOT NULL DEFAULT '',
  updated_by text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, requirement_id)
);
CREATE INDEX IF NOT EXISTS tenant_requirement_mappings_tenant_idx ON tenant_requirement_mappings (tenant_id, status);

CREATE TABLE IF NOT EXISTS control_tests (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  control_id text NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  tester_name text NOT NULL,
  tested_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  methodology text NOT NULL DEFAULT '',
  expected_result text NOT NULL DEFAULT '',
  actual_result text NOT NULL DEFAULT '',
  evidence_ids text NOT NULL DEFAULT '[]',
  notes text NOT NULL DEFAULT '',
  result text NOT NULL CHECK (result IN ('PASS','FAIL','PARTIAL','UNKNOWN','NEEDS_REVIEW')),
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The spec's own rule, enforced at the database, not just the app layer:
  -- "Do not permit PASS where required evidence is missing."
  CHECK (result != 'PASS' OR evidence_ids != '[]')
);
CREATE INDEX IF NOT EXISTS control_tests_control_idx ON control_tests (tenant_id, control_id, tested_at DESC);

CREATE TABLE IF NOT EXISTS risks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  likelihood text NOT NULL CHECK (likelihood IN ('LOW','MEDIUM','HIGH')),
  impact text NOT NULL CHECK (impact IN ('LOW','MEDIUM','HIGH')),
  related_control_ids text NOT NULL DEFAULT '[]',
  related_finding_ids text NOT NULL DEFAULT '[]',
  mitigation text NOT NULL DEFAULT '',
  residual_likelihood text CHECK (residual_likelihood IS NULL OR residual_likelihood IN ('LOW','MEDIUM','HIGH')),
  residual_impact text CHECK (residual_impact IS NULL OR residual_impact IN ('LOW','MEDIUM','HIGH')),
  owner_name text NOT NULL DEFAULT '',
  acceptance_status text NOT NULL DEFAULT 'OPEN' CHECK (acceptance_status IN ('OPEN','ACCEPTED','MITIGATED','TRANSFERRED')),
  accepted_by text,
  accepted_at timestamp,
  acceptance_rationale text,
  acceptance_scope text,
  review_date date,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- "Risk acceptance requires: authorized person, date, scope, rationale,
  -- expiration/review date" -- enforced here, not left to application
  -- discipline alone.
  CHECK (acceptance_status != 'ACCEPTED' OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND acceptance_rationale IS NOT NULL AND acceptance_scope IS NOT NULL AND review_date IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS risks_tenant_idx ON risks (tenant_id, acceptance_status, updated_at DESC);

-- Non-destructive governance layer over trust_findings -- see header comment.
-- A finding's real, evidence-derived status (OPEN/UNKNOWN/RESOLVED) is never
-- touched by this table; this only records a human governance decision
-- layered on top of it.
CREATE TABLE IF NOT EXISTS finding_dispositions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  finding_id text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('IN_PROGRESS','MITIGATED','ACCEPTED_RISK','FALSE_POSITIVE','NEEDS_REVIEW')),
  owner_name text,
  due_date date,
  business_impact text NOT NULL DEFAULT '',
  technical_impact text NOT NULL DEFAULT '',
  rationale text NOT NULL DEFAULT '',
  related_risk_id text,
  decided_by text NOT NULL,
  decided_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A disposition of ACCEPTED_RISK or FALSE_POSITIVE is exactly the kind of
  -- judgment the spec says "requires an authorized person + date + scope +
  -- rationale" -- rationale is mandatory for those two dispositions.
  CHECK (disposition NOT IN ('ACCEPTED_RISK','FALSE_POSITIVE') OR rationale != '')
);
CREATE INDEX IF NOT EXISTS finding_dispositions_finding_idx ON finding_dispositions (tenant_id, finding_id, decided_at DESC);

-- Additive, nullable extensions to the existing evidence ledger -- the
-- evidence engine itself is unchanged; these only let evidence be linked
-- into the new control/requirement layer and carry an explicit type/
-- confidence/review-date, none of which existed before.
ALTER TABLE evidence_ledger ADD COLUMN IF NOT EXISTS evidence_type text CHECK (evidence_type IS NULL OR evidence_type IN ('configuration','api_result','scan','document','policy','log','observation','screenshot','customer_provided','vendor_evidence','attestation','assessment','test_result'));
ALTER TABLE evidence_ledger ADD COLUMN IF NOT EXISTS confidence_basis_points integer CHECK (confidence_basis_points IS NULL OR (confidence_basis_points >= 0 AND confidence_basis_points <= 10000));
ALTER TABLE evidence_ledger ADD COLUMN IF NOT EXISTS review_at timestamp;
ALTER TABLE evidence_ledger ADD COLUMN IF NOT EXISTS related_control_id text;
ALTER TABLE evidence_ledger ADD COLUMN IF NOT EXISTS related_requirement_id text;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['policies','controls','tenant_requirement_mappings','control_tests','risks','finding_dispositions']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'spr_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON policies, controls, tenant_requirement_mappings, control_tests, risks, finding_dispositions TO spr_app_runtime;
    GRANT SELECT ON compliance_frameworks, compliance_requirements TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON policies, controls, tenant_requirement_mappings, control_tests, risks, finding_dispositions TO spr_worker_runtime;
    GRANT SELECT ON compliance_frameworks, compliance_requirements TO spr_worker_runtime;
  END IF;
END $$;

-- Catalog identity only -- real, verifiable, stable facts (a framework's own
-- name and version number), never its requirement text. Every row starts
-- REQUIRES_SOURCE_VERIFICATION; compliance_requirements stays empty until an
-- admin populates it from the framework's own authoritative publication.
INSERT INTO compliance_frameworks (id, framework_key, name, version, published_by) VALUES
  ('framework_nist_csf', 'nist-csf', 'NIST Cybersecurity Framework', '2.0', 'National Institute of Standards and Technology'),
  ('framework_cis', 'cis-controls', 'CIS Critical Security Controls', 'v8', 'Center for Internet Security'),
  ('framework_soc2', 'soc2', 'SOC 2 Trust Services Criteria', '2017 (with 2022 revisions)', 'AICPA'),
  ('framework_iso27001', 'iso-27001', 'ISO/IEC 27001', '2022', 'ISO/IEC'),
  ('framework_pci_dss', 'pci-dss', 'PCI Data Security Standard', 'v4.0', 'PCI Security Standards Council'),
  ('framework_hipaa', 'hipaa-security-rule', 'HIPAA Security Rule', '45 CFR Part 164, Subpart C', 'U.S. Department of Health and Human Services')
ON CONFLICT (framework_key) DO NOTHING;

COMMIT;
