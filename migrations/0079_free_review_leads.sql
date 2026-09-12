BEGIN;

-- Lead capture on the Free Review result: a visitor may download a PDF of
-- their result after giving a name and business email. One row per request,
-- in the Free Review system tenant, RLS-isolated like free_review_submissions.
-- The email is the lead's own input; the passport link proves which review it
-- belongs to. Nothing here is shown back as a "lead score" or similar.
CREATE TABLE IF NOT EXISTS free_review_leads (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  passport_id text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  company text,
  repository text NOT NULL,
  ip_hash text NOT NULL,
  consent_text text NOT NULL,
  consented_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS free_review_leads_created_idx ON free_review_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS free_review_leads_email_idx ON free_review_leads (lower(email));

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['free_review_leads'] LOOP
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
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT ON free_review_leads TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT ON free_review_leads TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
