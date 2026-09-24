-- Persist the production fail-closed Supabase RLS posture for internal-only tables.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agent_logs','billing_webhook_events','compliance_frameworks',
    'compliance_requirements','distribution_sender_verifications','founder_tasks',
    'plan_capabilities','registry_crawl_runs','registry_crawl_state','schema_migrations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'deny_client_access_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      'deny_client_access_' || t, t
    );
  END LOOP;
END $$;
