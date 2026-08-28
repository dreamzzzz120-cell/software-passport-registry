BEGIN;

-- MSP Time & Tool Savings: customer-entered baseline assumptions, used to
-- turn real, already-counted SPR activity (reports generated, questions
-- answered, vendor audits completed, remediations resolved) into an
-- ESTIMATED time-avoided figure. This table stores only the customer's own
-- inputs -- SPR never invents an industry-average baseline. One row per
-- tenant; all fields nullable because "insufficient data" (no baseline
-- entered yet) is a real, correctly-representable state, not an error.
CREATE TABLE IF NOT EXISTS msp_savings_baseline (
  tenant_id text PRIMARY KEY,
  hourly_rate numeric,
  report_baseline_minutes numeric,
  questionnaire_question_baseline_minutes numeric,
  vendor_review_baseline_minutes numeric,
  remediation_baseline_minutes numeric,
  tool_consolidation_monthly_cost numeric,
  spr_monthly_cost numeric,
  updated_by text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE msp_savings_baseline ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'msp_savings_baseline' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON msp_savings_baseline USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON msp_savings_baseline TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON msp_savings_baseline TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
