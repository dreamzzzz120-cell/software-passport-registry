BEGIN;

-- Migration 0011 dropped tenant_id's 'tenant-default' fallback and added a
-- non-default/non-empty CHECK constraint, but only on the `users` table. Every
-- other tenant-scoped table created by 0000-0018 still silently defaults
-- tenant_id to the literal string 'tenant-default' if a caller ever omits the
-- column, which would let two different tenants' buggy insert paths collide
-- into the same shared bucket. This finishes that hardening pass for every
-- table that carries a tenant_id column, the same way src/db/sync.ts already
-- discovers tenant-owned tables dynamically via information_schema instead of
-- a hand-maintained list that's easy to let drift out of date.
DO $$
DECLARE
  tbl record;
  has_invalid boolean;
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I WHERE tenant_id IS NULL OR btrim(tenant_id) = %L OR tenant_id = %L)',
      tbl.table_name, '', 'tenant-default'
    ) INTO has_invalid;

    IF has_invalid THEN
      RAISE EXCEPTION 'Table % has an invalid or default tenant_id value; tenant-default hardening aborted', tbl.table_name;
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id DROP DEFAULT', tbl.table_name);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl.table_name || '_tenant_nonempty_ck') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 256 AND tenant_id <> ''tenant-default'')',
        tbl.table_name, tbl.table_name || '_tenant_nonempty_ck'
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
