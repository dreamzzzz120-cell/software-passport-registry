-- SPDX-License-Identifier: Apache-2.0
-- Link user-visible scan records to their authoritative agent job.
-- This closes the gap where the UI scan remained "Scanning" after the worker
-- completed a different, synthetic scans row.

BEGIN;

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS job_id text;

CREATE INDEX IF NOT EXISTS scans_tenant_job
  ON scans (tenant_id, job_id);

CREATE UNIQUE INDEX IF NOT EXISTS scans_tenant_job_unique
  ON scans (tenant_id, job_id)
  WHERE job_id IS NOT NULL;

COMMIT;
