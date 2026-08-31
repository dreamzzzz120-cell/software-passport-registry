BEGIN;

-- Repair the runtime-role contract exposed by 0047.
-- 0020 granted privileges to tables that existed at that point, but later
-- migrations may have created tables under a different owner/default-privilege
-- context. Re-grant the least-privileged DML contract across the current
-- schema, and explicitly preserve the worker's documented cross-tenant access
-- without restoring BYPASSRLS.
GRANT USAGE ON SCHEMA public TO spr_app_runtime, spr_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spr_app_runtime, spr_worker_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spr_app_runtime, spr_worker_runtime;

-- Every tenant-scoped table remains protected by RLS. The application role is
-- constrained to the request tenant through app.tenant_id. The worker role is
-- an internal, non-HTTP principal and intentionally retains the cross-tenant
-- behavior previously provided by BYPASSRLS, but now through an explicit RLS
-- policy rather than a role-level bypass.
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

COMMIT;
