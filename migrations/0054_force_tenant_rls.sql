BEGIN;

-- Migration 0053 introduced spr_assert_tenant_rls(), which requires every
-- public table carrying a tenant_id column to have Row-Level Security both
-- ENABLED and FORCED. Migrations 0020/0021/0041/0042/0048 enabled RLS across
-- those tables but never forced it, and 0053 forced it on only the four tables
-- it created. The assertion has therefore never been satisfiable, which is why
-- production /ready has been reporting {"tenantRls":{"ok":false}} and serving
-- 503 while the database itself was healthy.
--
-- This migration closes the gap for real rather than relaxing the assertion.
-- FORCE ROW LEVEL SECURITY makes RLS apply to the table owner as well. The
-- owner here is a superuser, which bypasses RLS regardless, so this cannot
-- break the migrator, the runtime-role provisioner, or the self-passport
-- bootstrap. What it does remove is the silent hole documented in
-- src/db/index.ts: if APP_DATABASE_URL is ever unset and the HTTP API falls
-- back to the owner connection, tenant isolation no longer degrades to a
-- no-op for any non-superuser owner.
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl.table_name);

    -- Keep the isolation contract from 0048 intact for any table that reached
    -- this point without it.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl.table_name
        AND policyname = 'spr_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl.table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl.table_name
        AND policyname = 'spr_worker_cross_tenant'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_worker_cross_tenant ON %I FOR ALL TO spr_worker_runtime USING (current_user = ''spr_worker_runtime'') WITH CHECK (current_user = ''spr_worker_runtime'')',
        tbl.table_name
      );
    END IF;
  END LOOP;
END
$$;

-- Fail the deploy here rather than let /ready discover it in production.
SELECT spr_assert_tenant_rls();

COMMIT;
