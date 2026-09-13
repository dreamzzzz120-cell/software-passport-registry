BEGIN;

-- 12-dimension Trust Vector computations (src/trust/trust-vector.ts). One
-- row per computation so an earlier reading can be compared with a later
-- one. The vector is a companion view; it never feeds passports.*_score.
CREATE TABLE IF NOT EXISTS passport_trust_vectors (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  version text NOT NULL,
  vector_json jsonb NOT NULL,
  computed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS passport_trust_vectors_passport_idx ON passport_trust_vectors (tenant_id, passport_id, computed_at DESC);

ALTER TABLE passport_trust_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE passport_trust_vectors FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'passport_trust_vectors' AND policyname = 'spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON passport_trust_vectors
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT ON passport_trust_vectors TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
