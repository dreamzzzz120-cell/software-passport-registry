BEGIN;

-- Migration 0055 created three tables that carry a tenant_id column --
-- free_review_submissions, intake_sessions and intake_items -- but did not give
-- them the isolation contract every other tenant table in this schema has:
--
--   * free_review_submissions was ENABLEd but never FORCEd.
--   * intake_sessions and intake_items got no RLS, no policy and no grants.
--
-- spr_assert_tenant_rls() (migration 0053) requires every public base table with
-- a tenant_id column to have RLS both ENABLED and FORCED, so /ready has been
-- returning 503 {"tenantRls":{"ok":false}} in production ever since 0055 was
-- applied. More importantly than the failing probe: the two intake tables hold
-- customer-uploaded evidence with no database-level tenant backstop at all.
--
-- This migration closes the gap the same way 0054 did -- by adding the missing
-- contract rather than by relaxing the assertion.
--
-- Why this is safe for the anonymous intake funnel: every statement in
-- src/routes/universal-intake.ts runs on the privileged owner pool (`db`), not
-- the tenant-scoped `req.db`, and the owner is a superuser, which bypasses RLS
-- regardless of FORCE. Pre-signup sessions therefore keep working exactly as
-- they do today. What changes is that any query arriving over the least-
-- privileged spr_app_runtime role -- which is NOBYPASSRLS per 0047 -- is now
-- confined to its own tenant's rows.
--
-- Unclaimed intake rows have tenant_id IS NULL. `NULL = current_setting(...)`
-- evaluates to NULL, not true, so an unclaimed session is invisible to every
-- tenant-scoped read. That is the intended semantics: an unclaimed session
-- belongs to no workspace yet, and the random 128-bit session id remains its
-- only capability. POST /intake/claim assigns tenant_id at claim time.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['free_review_submissions', 'intake_sessions', 'intake_items']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'spr_tenant_isolation'
      ) THEN
        EXECUTE format(
          'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
          tbl
        );
      END IF;

      -- 0055 granted the runtime roles on free_review_submissions but not on
      -- the intake tables, so a tenant-scoped read of claimed intake would have
      -- failed on privileges before it ever reached a policy.
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_app_runtime', tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_worker_runtime', tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Fail loudly here rather than letting /ready discover it later: if any table
-- carrying tenant_id is still unhardened after this migration, the deploy
-- should stop instead of shipping a workspace boundary that does not hold.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name)
    INTO missing
  FROM information_schema.columns c
  JOIN pg_class r ON r.relname = c.table_name
  JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id'
    AND r.relkind = 'r'
    AND (NOT r.relrowsecurity OR NOT r.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TENANT_RLS_NOT_HARDENED after 0056:%', missing;
  END IF;
END $$;

COMMIT;
