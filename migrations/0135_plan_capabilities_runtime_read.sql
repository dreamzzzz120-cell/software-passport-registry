BEGIN;

-- plan_capabilities is global product configuration, not tenant-owned data.
-- Direct Supabase client roles remain denied; the trusted app and worker
-- runtime roles need read-only access so confirmed paid plans can resolve
-- their capability catalog.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT ON public.plan_capabilities TO spr_app_runtime;
    DROP POLICY IF EXISTS spr_plan_capabilities_app_read ON public.plan_capabilities;
    CREATE POLICY spr_plan_capabilities_app_read
      ON public.plan_capabilities
      FOR SELECT
      TO spr_app_runtime
      USING (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT ON public.plan_capabilities TO spr_worker_runtime;
    DROP POLICY IF EXISTS spr_plan_capabilities_worker_read ON public.plan_capabilities;
    CREATE POLICY spr_plan_capabilities_worker_read
      ON public.plan_capabilities
      FOR SELECT
      TO spr_worker_runtime
      USING (true);
  END IF;
END $$;

COMMIT;
