BEGIN;

-- Migration 0080 removed the placeholder self passport by walking foreign
-- keys to passports(id). Verified against production afterwards: 7
-- evidence_items rows for asset_id = 'passport_spr_self' survived, because
-- evidence_items (and the other tables that address a passport through an
-- asset_id or passport_id column) carry no foreign key. Those rows are the
-- "SBOM scan assessment / SBOM_EMPTY" results of scans that examined nothing.
-- This pass deletes by column name instead of by constraint, so any table
-- that names a passport, with or without a foreign key, is covered.
DO $$
DECLARE
  col record;
  n bigint;
BEGIN
  FOR col IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('asset_id', 'passport_id')
      AND table_name <> 'passports'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE %I = %L', col.table_name, col.column_name, 'passport_spr_self');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'removed % placeholder row(s) from %.%', n, col.table_name, col.column_name; END IF;
  END LOOP;
END $$;

COMMIT;
