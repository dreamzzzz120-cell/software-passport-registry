BEGIN;

-- Supabase/Data-API hardening:
-- Tenant isolation is enforced by the trusted server runtime role, not PUBLIC.
-- Direct Supabase browser roles are explicitly revoked on these internal tables
-- so anonymous/permanent Auth users cannot gain access if grants drift later.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'distribution_aeo_queries',
    'growth_content_opportunities',
    'growth_experiments',
    'growth_referral_links',
    'growth_registry_claims',
    'provider_software_inventory_runs',
    'provider_software_observations'
  ];
  internal_tables text[] := ARRAY[
    'growth_agents',
    'spr_migration_fk_backup'
  ];
  has_app_role boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime');
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Remove the PUBLIC policy that also matched Supabase anonymous users.
    EXECUTE format('DROP POLICY IF EXISTS spr_tenant_isolation ON public.%I', t);

    IF has_app_role THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON public.%I FOR ALL TO spr_app_runtime USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        t
      );
    END IF;

    IF has_anon THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', t);
    END IF;
    IF has_authenticated THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY internal_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    ALTER TABLE IF EXISTS public.growth_agents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.spr_migration_fk_backup ENABLE ROW LEVEL SECURITY;

    IF has_anon THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', t);
      EXECUTE format('DROP POLICY IF EXISTS spr_deny_anon ON public.%I', t);
      EXECUTE format('CREATE POLICY spr_deny_anon ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)', t);
    END IF;
    IF has_authenticated THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS spr_deny_authenticated ON public.%I', t);
      EXECUTE format('CREATE POLICY spr_deny_authenticated ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
