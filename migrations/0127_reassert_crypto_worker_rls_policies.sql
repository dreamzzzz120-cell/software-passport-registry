BEGIN;

-- Migrations 0124-0126 add new tenant-scoped tables after 0108's schema-wide
-- worker policy pass. Reassert the policy contract for every current tenant
-- table without broadening table grants: the per-table GRANTs remain the
-- authority for which operations the worker may perform.
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

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public'
        AND tablename=tbl.table_name
        AND policyname='spr_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl.table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public'
        AND tablename=tbl.table_name
        AND policyname='spr_worker_cross_tenant'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_worker_cross_tenant ON %I FOR ALL TO spr_worker_runtime USING (current_user = ''spr_worker_runtime'') WITH CHECK (current_user = ''spr_worker_runtime'')',
        tbl.table_name
      );
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name)
  INTO missing
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema=c.table_schema
   AND t.table_name=c.table_name
  WHERE c.table_schema='public'
    AND c.column_name='tenant_id'
    AND t.table_type='BASE TABLE'
    AND (
      NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname='public'
          AND p.tablename=c.table_name
          AND p.policyname='spr_tenant_isolation'
      )
      OR NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname='public'
          AND p.tablename=c.table_name
          AND p.policyname='spr_worker_cross_tenant'
      )
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TENANT_RLS_POLICY_MISSING after 0127:%', missing;
  END IF;
END
$$;

COMMIT;
