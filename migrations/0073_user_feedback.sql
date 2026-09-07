-- 0073: User feedback -- any signed-in user can send a like/dislike, a bug
-- report, or a free-text suggestion. Founder-visible across every tenant via
-- GET /api/founder/feedback; a tenant's own users can list their own tenant's
-- feedback via GET /api/feedback (tenant-scoped, req.db).
--
-- 0069 documents a real incident: a new tenant_id table created without RLS
-- enabled/forced/granted degrades /ready and blocks every subsequent deploy.
-- This migration hardens the table in the same transaction it's created in,
-- following 0056/0069's exact idiom, and ends with the same fail-closed
-- assertion so a mistake here is caught at migration time, not in production.

BEGIN;

CREATE TABLE IF NOT EXISTS user_feedback (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sentiment text NOT NULL CHECK (sentiment IN ('like', 'dislike', 'neutral')),
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('bug', 'complaint', 'suggestion', 'general')),
  page text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_feedback_tenant_idx ON user_feedback (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_feedback_status_idx ON user_feedback (status, created_at DESC);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['user_feedback'] LOOP
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

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_app_runtime', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_worker_runtime', tbl);
    END IF;
  END LOOP;
END $$;

-- Founder cross-tenant reads (GET /api/founder/feedback) go through the plain
-- `db` import, same as the rest of founder-command-center.ts -- that
-- connection is the privileged BYPASSRLS one, so it does not need a grant
-- keyed to any single tenant. No additional grant needed here for that path.

SELECT spr_assert_tenant_rls();

COMMIT;
