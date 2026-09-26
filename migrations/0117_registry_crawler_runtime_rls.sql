BEGIN;

-- registry_crawl_state and registry_crawl_runs are global operational telemetry,
-- not tenant-owned data. The crawler runs as the least-privileged
-- spr_worker_runtime role. If RLS is enabled on these tables, ordinary GRANTs
-- are insufficient, so explicitly authorize only that internal worker role.
-- Do not restore BYPASSRLS and do not expose these tables to tenant roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON registry_crawl_state, registry_crawl_runs TO spr_worker_runtime;

    ALTER TABLE registry_crawl_state ENABLE ROW LEVEL SECURITY;
    ALTER TABLE registry_crawl_state FORCE ROW LEVEL SECURITY;
    ALTER TABLE registry_crawl_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE registry_crawl_runs FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS spr_worker_registry_crawl_state ON registry_crawl_state;
    CREATE POLICY spr_worker_registry_crawl_state
      ON registry_crawl_state
      FOR ALL
      TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');

    DROP POLICY IF EXISTS spr_worker_registry_crawl_runs ON registry_crawl_runs;
    CREATE POLICY spr_worker_registry_crawl_runs
      ON registry_crawl_runs
      FOR ALL
      TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END
$$;

COMMIT;
