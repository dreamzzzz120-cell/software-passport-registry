BEGIN;

-- Free Review: anonymous visitors submit a public GitHub repository and get
-- a real scan run through the same repository_scan / repository_security_scan
-- pipeline authenticated users use (osv-worker.ts / security-scanner-worker.ts).
-- No new evidence pipeline is introduced here. This table exists purely for
-- abuse control (a daily per-IP submission cap) -- it is not part of the
-- passport/evidence data model. Every row belongs to the single fixed system
-- tenant 'tenant-free-review-system'; the CHECK constraint makes that a
-- DB-enforced invariant rather than an application convention, matching the
-- approach in migrations/0019_tenant_default_hardening.sql.

CREATE TABLE IF NOT EXISTS free_review_submissions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  passport_id text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  -- HMAC-SHA256 of the client IP (keyed with SPR_PUBLIC_PASSPORT_SECRET),
  -- never the raw IP -- keeps the daily abuse cap's exact-match lookup
  -- possible without persisting an anonymous visitor's real address.
  ip_hash text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS free_review_submissions_ip_created_idx
  ON free_review_submissions (ip_hash, created_at DESC);

-- Standard tenant-scoped-table boilerplate (RLS + grants), the same 3-part
-- pattern every table added since migration 0021 follows -- see
-- migrations/0042_privacy_management.sql:86-106 for the reference version.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE free_review_submissions ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'free_review_submissions' AND policyname = 'spr_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON free_review_submissions USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON free_review_submissions TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON free_review_submissions TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
