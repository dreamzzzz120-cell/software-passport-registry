BEGIN;

-- Observed in production on 2026-09-18 (event worker_database_verified):
-- the worker connected as the owner role `postgres`, not `spr_worker_runtime`.
-- Every tenant-scoped table the worker touches therefore ran with RLS
-- bypassed. The runtime role could not simply be switched on, because 18
-- tenant tables created after 0048 never received the explicit
-- spr_worker_cross_tenant policy that 0048 gave the tables of its day
-- (distribution_*, intake_items, intake_sessions, free_review_leads,
-- passport_trust_vectors, psa_webhook_*, tenant_addons, tenant_custom_domains,
-- tenant_dpa_executions, traffic_events, trust_council_sessions,
-- user_feedback, ...). Under the least-privileged role the worker's reads on
-- those tables would return nothing and its writes would be rejected.
--
-- This migration re-runs 0048's contract over the CURRENT schema, idempotently:
-- every public base table with a tenant_id column has RLS enabled and forced,
-- the tenant-isolation policy for app.tenant_id, the explicit cross-tenant
-- policy for the worker role (a policy, not BYPASSRLS), and least-privilege DML
-- grants for both runtime roles. Nothing is dropped or relaxed. It is what
-- makes switching WORKER_DATABASE_URL to spr_worker_runtime safe.
GRANT USAGE ON SCHEMA public TO spr_app_runtime, spr_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spr_app_runtime, spr_worker_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spr_app_runtime, spr_worker_runtime;

DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl.table_name);

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl.table_name AND policyname = 'spr_tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl.table_name
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl.table_name AND policyname = 'spr_worker_cross_tenant') THEN
      EXECUTE format(
        'CREATE POLICY spr_worker_cross_tenant ON %I FOR ALL TO spr_worker_runtime USING (current_user = ''spr_worker_runtime'') WITH CHECK (current_user = ''spr_worker_runtime'')',
        tbl.table_name
      );
    END IF;
  END LOOP;
END
$$;

-- Fail the release if any tenant table is still without the worker policy.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name)
    INTO missing
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name AND p.policyname = 'spr_worker_cross_tenant');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'WORKER_RLS_POLICY_MISSING after 0108:%', missing;
  END IF;
END $$;

COMMIT;
