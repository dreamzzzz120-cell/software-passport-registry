BEGIN;

-- Performance indexes for the tenant-scoped evidence and finding hot paths.
-- Version 0045 is reserved by production traffic telemetry; this migration
-- owns the indexes without changing the already-deployed migration history.

CREATE INDEX IF NOT EXISTS evidence_items_tenant_asset_idx
  ON evidence_items (tenant_id, asset_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS scan_findings_tenant_asset_idx
  ON scan_findings (tenant_id, asset_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS scan_findings_job_idx
  ON scan_findings (job_id, tenant_id);

COMMIT;
