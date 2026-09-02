BEGIN;

-- Recovery-safe consolidation of the two migrations that were accidentally
-- assigned version 0044. The migration runner keys history by version, so both
-- schemas live behind one new version. Every statement is idempotent so this
-- safely repairs databases that may already have applied either 0044 file.

-- Free Review abuse-control table.
CREATE TABLE IF NOT EXISTS free_review_submissions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  passport_id text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  ip_hash text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS free_review_submissions_ip_created_idx
  ON free_review_submissions (ip_hash, created_at DESC);

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

-- Universal MSP intake quarantine/session storage.
CREATE TABLE IF NOT EXISTS intake_sessions (
  id text PRIMARY KEY,
  tenant_id text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLAIMED','CLOSED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  created_by text,
  claimed_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_intake_sessions_tenant ON intake_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_expiry ON intake_sessions(expires_at);

CREATE TABLE IF NOT EXISTS intake_items (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  tenant_id text,
  name text NOT NULL,
  size bigint NOT NULL CHECK (size >= 0 AND size <= 104857600),
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  kind text NOT NULL DEFAULT 'unknown' CHECK (kind IN ('software','document','sbom','archive','unknown')),
  storage_bucket text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'AWAITING_UPLOAD' CHECK (status IN ('AWAITING_UPLOAD','UPLOADED','QUEUED','PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','PURGED')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_intake_items_session ON intake_items(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_items_tenant ON intake_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_intake_items_status ON intake_items(status);

COMMIT;
