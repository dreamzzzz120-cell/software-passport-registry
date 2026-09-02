-- SPDX-License-Identifier: Apache-2.0
-- Universal MSP Intake: short-lived quarantine sessions and durable evidence metadata.
BEGIN;

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
