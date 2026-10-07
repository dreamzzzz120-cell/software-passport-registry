BEGIN;

-- plan_capabilities is global product configuration, not tenant-owned data.
-- Migration 0114 correctly denied direct Supabase client roles, but enabling
-- RLS without a runtime policy also hid the catalog from spr_app_runtime.
-- That made a confirmed paid subscription fail every capability check.
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
