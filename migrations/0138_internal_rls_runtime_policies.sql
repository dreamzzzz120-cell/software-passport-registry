BEGIN;

-- Give internal RLS tables explicit trusted-runtime policies so they are
-- neither policy-less nor reachable by Supabase browser/Auth roles.
DO $$
BEGIN
  IF to_regclass('public.growth_agents') IS NOT NULL THEN
    ALTER TABLE public.growth_agents ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS spr_internal_runtime_access ON public.growth_agents;
    CREATE POLICY spr_internal_runtime_access
      ON public.growth_agents
      FOR ALL
      TO spr_app_runtime, spr_worker_runtime, spr_migration_runtime
      USING (true)
      WITH CHECK (true);

    REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM authenticated;
  END IF;

  IF to_regclass('public.spr_migration_fk_backup') IS NOT NULL THEN
    ALTER TABLE public.spr_migration_fk_backup ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS spr_migration_runtime_access ON public.spr_migration_fk_backup;
    CREATE POLICY spr_migration_runtime_access
      ON public.spr_migration_fk_backup
      FOR ALL
      TO spr_migration_runtime
      USING (true)
      WITH CHECK (true);

    REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM spr_app_runtime;
    REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM spr_worker_runtime;
  END IF;
END $$;

COMMIT;
