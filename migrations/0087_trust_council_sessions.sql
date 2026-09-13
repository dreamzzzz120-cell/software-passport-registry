BEGIN;

-- Trust Council sessions (src/routes/ai-trust.ts POST /trust-council). Each
-- row is one convened panel: the seat reviews, the chair synthesis, the
-- verdict and the model provenance, stored as their own record. Nothing
-- here feeds passports, findings or scores; it is AI explanation, kept so
-- an operator can see what was said, by which model, over which evidence.
CREATE TABLE IF NOT EXISTS trust_council_sessions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('APPROVE', 'CONDITIONAL', 'REJECT', 'INSUFFICIENT_EVIDENCE')),
  result_json jsonb NOT NULL,
  provenance_json jsonb NOT NULL,
  chair_note text,
  requested_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS trust_council_sessions_passport_idx ON trust_council_sessions (tenant_id, passport_id, created_at DESC);

ALTER TABLE trust_council_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_council_sessions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trust_council_sessions' AND policyname = 'spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON trust_council_sessions
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT ON trust_council_sessions TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
