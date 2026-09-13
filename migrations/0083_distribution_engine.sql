BEGIN;

CREATE TABLE IF NOT EXISTS distribution_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  kind text NOT NULL CHECK (kind IN ('research_url', 'qualify_lead', 'prepare_outreach')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead_letter')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at timestamp,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS distribution_jobs_ready_idx
  ON distribution_jobs (available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS distribution_jobs_status_idx
  ON distribution_jobs (status, updated_at DESC);

ALTER TABLE distribution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_jobs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'distribution_jobs' AND policyname = 'spr_tenant_isolation'
  ) THEN
    CREATE POLICY spr_tenant_isolation ON distribution_jobs
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_jobs TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, UPDATE ON distribution_jobs TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
