BEGIN;

-- Harden pg_cron metadata exposure only when the migration role owns the
-- extension objects. Supabase-managed pg_cron objects are owned by
-- supabase_admin; postgres cannot ALTER their policies and must not make a
-- fresh/replay migration fail. In that managed case the cron schema remains
-- inaccessible to anon/authenticated roles, so the extension-owned policy is
-- advisory noise rather than an exposed SPR data path.
DO $$
DECLARE
  job_owned boolean := false;
  details_owned boolean := false;
  cron_schema_owned boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT pg_get_userbyid(c.relowner) = current_user
      INTO job_owned
      FROM pg_class c
      WHERE c.oid = 'cron.job'::regclass;

    IF job_owned THEN
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
    ELSE
      RAISE NOTICE 'Skipping cron.job ACL/policy hardening: current role % does not own managed pg_cron table', current_user;
    END IF;
  END IF;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    SELECT pg_get_userbyid(c.relowner) = current_user
      INTO details_owned
      FROM pg_class c
      WHERE c.oid = 'cron.job_run_details'::regclass;

    IF details_owned THEN
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
    ELSE
      RAISE NOTICE 'Skipping cron.job_run_details ACL/policy hardening: current role % does not own managed pg_cron table', current_user;
    END IF;
  END IF;

  SELECT pg_get_userbyid(n.nspowner) = current_user
    INTO cron_schema_owned
    FROM pg_namespace n
    WHERE n.nspname='cron';

  IF cron_schema_owned THEN
    REVOKE USAGE ON SCHEMA cron FROM PUBLIC;
    REVOKE USAGE ON SCHEMA cron FROM anon;
    REVOKE USAGE ON SCHEMA cron FROM authenticated;
    GRANT USAGE ON SCHEMA cron TO postgres;
  ELSIF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cron') THEN
    RAISE NOTICE 'Skipping cron schema ACL hardening: current role % does not own managed pg_cron schema', current_user;
  END IF;
END $$;

COMMIT;
