BEGIN;

CREATE TABLE IF NOT EXISTS revenue_opportunity_reviews (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  finding_id text NOT NULL,
  passport_id text NOT NULL,
  client_id text,
  action text NOT NULL CHECK (action IN ('ACCEPTED_FOR_REVIEW', 'DISMISSED')),
  actor_id text NOT NULL,
  evidence_ids jsonb NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS revenue_opportunity_reviews_finding_idx
  ON revenue_opportunity_reviews (tenant_id, finding_id, created_at DESC);

ALTER TABLE revenue_opportunity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_opportunity_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON revenue_opportunity_reviews;
CREATE POLICY spr_tenant_isolation ON revenue_opportunity_reviews
  FOR ALL TO spr_app_runtime
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS spr_worker_cross_tenant ON revenue_opportunity_reviews;
CREATE POLICY spr_worker_cross_tenant ON revenue_opportunity_reviews
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT ON revenue_opportunity_reviews TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT ON revenue_opportunity_reviews TO spr_worker_runtime;
  END IF;
END $$;

SELECT spr_assert_tenant_rls();
COMMIT;
