BEGIN;

-- Harden pg_cron metadata exposure for this deployment.
-- All current SPR scheduled jobs run as postgres; no application runtime calls
-- pg_cron directly. Keep scheduler metadata private to postgres and remove the
-- extension's inherited PUBLIC table privileges.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON TABLE cron.job FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE cron.job FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE cron.job FROM authenticated;
    GRANT SELECT ON TABLE cron.job TO postgres;

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='cron' AND tablename='job' AND policyname='cron_job_policy'
    ) THEN
      ALTER POLICY cron_job_policy ON cron.job TO postgres;
    END IF;
  END IF;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
      ON TABLE cron.job_run_details TO postgres;

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='cron' AND tablename='job_run_details' AND policyname='cron_job_run_details_policy'
    ) THEN
      ALTER POLICY cron_job_run_details_policy ON cron.job_run_details TO postgres;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cron') THEN
    REVOKE USAGE ON SCHEMA cron FROM PUBLIC;
    REVOKE USAGE ON SCHEMA cron FROM anon;
    REVOKE USAGE ON SCHEMA cron FROM authenticated;
    GRANT USAGE ON SCHEMA cron TO postgres;
  END IF;
END $$;

COMMIT;
