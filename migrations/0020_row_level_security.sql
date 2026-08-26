BEGIN;

-- Defense-in-depth for tenant isolation: until now, every route handler had to
-- remember its own `WHERE tenant_id = ...` filter with nothing at the database
-- layer to catch a missed one on a SELECT (the triggers added in prior
-- migrations only fire on INSERT/UPDATE/DELETE). This migration adds two
-- least-privileged roles and Row-Level Security policies that make the
-- database itself refuse to return or write a row outside the caller's
-- current tenant.
--
-- This is intentionally non-breaking for anyone who has not yet adopted it:
-- table OWNERS always bypass RLS in Postgres, and every deployment continues
-- to run its existing DATABASE_URL connection as that owner. Nothing here
-- restricts anything until an operator provisions APP_DATABASE_URL /
-- WORKER_DATABASE_URL to point at the new roles below (see .env.example) and
-- sets their passwords with scripts/provision-runtime-roles.ts.
--
--   spr_app_runtime    - used by the HTTP API (src/middleware/tenant-scope.ts
--                        sets app.tenant_id per request); bound by RLS.
--   spr_worker_runtime - used by background workers, which legitimately poll
--                        job queues across every tenant; granted BYPASSRLS
--                        since its access pattern is inherently cross-tenant
--                        and it is never driven by untrusted HTTP input.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    CREATE ROLE spr_app_runtime LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    CREATE ROLE spr_worker_runtime LOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO spr_app_runtime, spr_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spr_app_runtime, spr_worker_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spr_app_runtime, spr_worker_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spr_app_runtime, spr_worker_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO spr_app_runtime, spr_worker_runtime;

DO $$
DECLARE tbl record;
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl.table_name AND policyname = 'spr_tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl.table_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
