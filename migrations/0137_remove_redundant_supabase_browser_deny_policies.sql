BEGIN;

-- Keep Supabase client roles explicitly revoked from internal operational tables.
-- No RLS policy is required for these roles because they have no table privileges.
DROP POLICY IF EXISTS spr_deny_anon ON public.growth_agents;
DROP POLICY IF EXISTS spr_deny_authenticated ON public.growth_agents;
DROP POLICY IF EXISTS spr_deny_anon ON public.spr_migration_fk_backup;
DROP POLICY IF EXISTS spr_deny_authenticated ON public.spr_migration_fk_backup;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM authenticated;
  END IF;
END $$;

COMMIT;
