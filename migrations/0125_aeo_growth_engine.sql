BEGIN;

CREATE TABLE IF NOT EXISTS distribution_aeo_queries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id = 'tenant-free-review-system'),
  question text NOT NULL,
  intent text NOT NULL DEFAULT 'informational',
  target_path text,
  status text NOT NULL DEFAULT 'backlog',
  answer_evidence text NOT NULL DEFAULT '[]',
  observed_mentions integer NOT NULL DEFAULT 0,
  observed_citations integer NOT NULL DEFAULT 0,
  last_checked_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT distribution_aeo_queries_status_check CHECK (status IN ('backlog','published','monitoring','retired')),
  CONSTRAINT distribution_aeo_queries_intent_check CHECK (intent IN ('informational','commercial','comparison','navigational'))
);

CREATE UNIQUE INDEX IF NOT EXISTS distribution_aeo_queries_question_unique
  ON distribution_aeo_queries (tenant_id, lower(question));
CREATE INDEX IF NOT EXISTS distribution_aeo_queries_status_idx
  ON distribution_aeo_queries (tenant_id, status, updated_at DESC);

ALTER TABLE distribution_aeo_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_aeo_queries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='distribution_aeo_queries' AND policyname='spr_tenant_isolation'
  ) THEN
    CREATE POLICY spr_tenant_isolation ON distribution_aeo_queries
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON distribution_aeo_queries TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, UPDATE ON distribution_aeo_queries TO spr_worker_runtime;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='distribution_aeo_queries' AND policyname='spr_worker_cross_tenant') THEN
      CREATE POLICY spr_worker_cross_tenant ON distribution_aeo_queries FOR ALL TO spr_worker_runtime USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');
    END IF;
  END IF;
END $$;

COMMIT;
