BEGIN;

-- Harden policies that were created without an explicit TO role. The table
-- grants already exclude Supabase anon/authenticated, but a PUBLIC RLS policy
-- needlessly widens the policy surface and is flagged by the database advisor.
-- The API runtime gets the tenant policy; worker and migration roles retain
-- their separately named policies.
DO $$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'distribution_aeo_queries',
      'growth_content_opportunities',
      'growth_experiments',
      'growth_referral_links',
      'growth_registry_claims',
      'provider_software_inventory_runs',
      'provider_software_observations'
    ]
    LOOP
      IF to_regclass('public.' || table_name) IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM pg_policies
           WHERE schemaname='public' AND tablename=table_name
             AND policyname='spr_tenant_isolation'
         ) THEN
        EXECUTE format(
          'ALTER POLICY spr_tenant_isolation ON public.%I TO spr_app_runtime',
          table_name
        );
      END IF;
    END LOOP;
  END IF;
END $$;

-- growth_agents is global operational metadata, not tenant customer data. It
-- intentionally has no tenant_id. Keep it fail-closed to the application
-- runtime and permit only the background worker role that maintains global
-- growth automation state.
DO $$
BEGIN
  IF to_regclass('public.growth_agents') IS NOT NULL THEN
    ALTER TABLE public.growth_agents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.growth_agents FORCE ROW LEVEL SECURITY;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='growth_agents'
           AND policyname='spr_app_growth_agents_deny'
       ) THEN
      CREATE POLICY spr_app_growth_agents_deny
        ON public.growth_agents
        FOR ALL TO spr_app_runtime
        USING (false) WITH CHECK (false);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='growth_agents'
           AND policyname='spr_worker_growth_agents'
       ) THEN
      CREATE POLICY spr_worker_growth_agents
        ON public.growth_agents
        FOR ALL TO spr_worker_runtime
        USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;

-- This is migration bookkeeping containing schema definitions, never customer
-- application data. Give the migration runtime the only ordinary RLS path and
-- make explicit that app/worker runtimes cannot read or mutate it.
DO $$
BEGIN
  IF to_regclass('public.spr_migration_fk_backup') IS NOT NULL THEN
    ALTER TABLE public.spr_migration_fk_backup ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.spr_migration_fk_backup FORCE ROW LEVEL SECURITY;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_migration_runtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='spr_migration_fk_backup'
           AND policyname='spr_migration_fk_backup_access'
       ) THEN
      CREATE POLICY spr_migration_fk_backup_access
        ON public.spr_migration_fk_backup
        FOR ALL TO spr_migration_runtime
        USING (true) WITH CHECK (true);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='spr_migration_fk_backup'
           AND policyname='spr_app_migration_backup_deny'
       ) THEN
      CREATE POLICY spr_app_migration_backup_deny
        ON public.spr_migration_fk_backup
        FOR ALL TO spr_app_runtime
        USING (false) WITH CHECK (false);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='spr_migration_fk_backup'
           AND policyname='spr_worker_migration_backup_deny'
       ) THEN
      CREATE POLICY spr_worker_migration_backup_deny
        ON public.spr_migration_fk_backup
        FOR ALL TO spr_worker_runtime
        USING (false) WITH CHECK (false);
    END IF;
  END IF;
END $$;

COMMIT;
