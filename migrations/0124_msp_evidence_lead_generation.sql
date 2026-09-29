-- MSP evidence-backed lead generation hardening
-- Fail closed, tenant scoped, human-approved outreach.

CREATE TABLE IF NOT EXISTS msp_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name text NOT NULL CHECK (length(trim(company_name)) BETWEEN 1 AND 240),
  company_domain text,
  jurisdiction text,
  status text NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN ('DISCOVERED','EVIDENCE_PENDING','QUALIFIED','REVIEW_REQUIRED','APPROVED','CONTACTED','REPLIED','MEETING','PROPOSAL','WON','LOST','DISQUALIFIED')),
  qualification_rule_version text,
  qualification_confidence numeric(5,4) CHECK (qualification_confidence IS NULL OR (qualification_confidence >= 0 AND qualification_confidence <= 1)),
  estimated_value_cents bigint CHECK (estimated_value_cents IS NULL OR estimated_value_cents >= 0),
  estimate_assumptions jsonb,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_domain)
);

CREATE TABLE IF NOT EXISTS msp_lead_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES msp_leads(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_locator text NOT NULL,
  observed_fact text NOT NULL,
  observed_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  freshness_state text NOT NULL CHECK (freshness_state IN ('CURRENT','STALE','UNKNOWN')),
  raw_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, evidence_digest)
);

CREATE TABLE IF NOT EXISTS msp_lead_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES msp_leads(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS msp_lead_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  normalized_target text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, normalized_target)
);

CREATE TABLE IF NOT EXISTS msp_lead_outreach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES msp_leads(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL','PHONE','OTHER')),
  target text NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED','SENT','DELIVERED','REPLIED','FAILED','SUPPRESSED')),
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS msp_leads_tenant_status_idx ON msp_leads(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS msp_lead_evidence_lead_idx ON msp_lead_evidence(tenant_id, lead_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS msp_lead_reviews_lead_idx ON msp_lead_reviews(tenant_id, lead_id, created_at DESC);

ALTER TABLE msp_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_leads FORCE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_suppressions FORCE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_outreach_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_lead_outreach_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS msp_leads_tenant_isolation ON msp_leads;
CREATE POLICY msp_leads_tenant_isolation ON msp_leads USING (tenant_id = spr_current_tenant_id()) WITH CHECK (tenant_id = spr_current_tenant_id());
DROP POLICY IF EXISTS msp_lead_evidence_tenant_isolation ON msp_lead_evidence;
CREATE POLICY msp_lead_evidence_tenant_isolation ON msp_lead_evidence USING (tenant_id = spr_current_tenant_id()) WITH CHECK (tenant_id = spr_current_tenant_id());
DROP POLICY IF EXISTS msp_lead_reviews_tenant_isolation ON msp_lead_reviews;
CREATE POLICY msp_lead_reviews_tenant_isolation ON msp_lead_reviews USING (tenant_id = spr_current_tenant_id()) WITH CHECK (tenant_id = spr_current_tenant_id());
DROP POLICY IF EXISTS msp_lead_suppressions_tenant_isolation ON msp_lead_suppressions;
CREATE POLICY msp_lead_suppressions_tenant_isolation ON msp_lead_suppressions USING (tenant_id = spr_current_tenant_id()) WITH CHECK (tenant_id = spr_current_tenant_id());
DROP POLICY IF EXISTS msp_lead_outreach_tenant_isolation ON msp_lead_outreach_events;
CREATE POLICY msp_lead_outreach_tenant_isolation ON msp_lead_outreach_events USING (tenant_id = spr_current_tenant_id()) WITH CHECK (tenant_id = spr_current_tenant_id());

-- Evidence is append-only to preserve the basis for every lead claim.
CREATE OR REPLACE FUNCTION spr_reject_lead_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'lead evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS msp_lead_evidence_immutable_update ON msp_lead_evidence;
CREATE TRIGGER msp_lead_evidence_immutable_update BEFORE UPDATE OR DELETE ON msp_lead_evidence FOR EACH ROW EXECUTE FUNCTION spr_reject_lead_evidence_mutation();

-- Cross-tenant parent references are rejected even if a privileged role bypasses RLS.
CREATE OR REPLACE FUNCTION spr_enforce_lead_child_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM msp_leads l WHERE l.id=NEW.lead_id AND l.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'lead tenant mismatch';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS msp_lead_evidence_tenant_guard ON msp_lead_evidence;
CREATE TRIGGER msp_lead_evidence_tenant_guard BEFORE INSERT ON msp_lead_evidence FOR EACH ROW EXECUTE FUNCTION spr_enforce_lead_child_tenant();
DROP TRIGGER IF EXISTS msp_lead_reviews_tenant_guard ON msp_lead_reviews;
CREATE TRIGGER msp_lead_reviews_tenant_guard BEFORE INSERT ON msp_lead_reviews FOR EACH ROW EXECUTE FUNCTION spr_enforce_lead_child_tenant();
DROP TRIGGER IF EXISTS msp_lead_outreach_tenant_guard ON msp_lead_outreach_events;
CREATE TRIGGER msp_lead_outreach_tenant_guard BEFORE INSERT ON msp_lead_outreach_events FOR EACH ROW EXECUTE FUNCTION spr_enforce_lead_child_tenant();

-- Outreach is fail-closed: explicit approval + current evidence + no suppression.
CREATE OR REPLACE FUNCTION spr_guard_lead_outreach() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM msp_leads l
    WHERE l.id=NEW.lead_id AND l.tenant_id=NEW.tenant_id
      AND l.status IN ('APPROVED','CONTACTED','REPLIED','MEETING','PROPOSAL')
      AND l.approved_at IS NOT NULL AND l.approved_by IS NOT NULL
  ) THEN RAISE EXCEPTION 'lead is not human-approved for outreach'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM msp_lead_evidence e
    WHERE e.lead_id=NEW.lead_id AND e.tenant_id=NEW.tenant_id
      AND e.freshness_state='CURRENT' AND e.confidence > 0
  ) THEN RAISE EXCEPTION 'lead has no current supporting evidence'; END IF;
  IF EXISTS (
    SELECT 1 FROM msp_lead_suppressions s
    WHERE s.tenant_id=NEW.tenant_id AND s.normalized_target=lower(trim(NEW.target))
  ) THEN RAISE EXCEPTION 'outreach target is suppressed'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS msp_lead_outreach_guard ON msp_lead_outreach_events;
CREATE TRIGGER msp_lead_outreach_guard BEFORE INSERT ON msp_lead_outreach_events FOR EACH ROW EXECUTE FUNCTION spr_guard_lead_outreach();
