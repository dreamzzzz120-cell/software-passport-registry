BEGIN;

-- Performance: evidence_items and scan_findings carried no index at all
-- beyond their `id` primary key, yet every hot read filters them by
-- (tenant_id, asset_id).
--
-- GET /api/user/passports runs two correlated subqueries PER passport:
--
--   (SELECT json_agg(...) FROM evidence_items e
--      WHERE e.tenant_id=p.tenant_id AND e.asset_id=p.id ORDER BY e.timestamp DESC)
--   (SELECT json_agg(...) FROM scan_findings f
--      WHERE f.tenant_id=p.tenant_id AND f.asset_id=p.id ORDER BY f.detected_at DESC)
--
-- With no supporting index each of those is a sequential scan of the whole
-- table, repeated for every passport row. Measured in production that made
-- /api/user/passports take ~4.3s and the seven-request dashboard load feel
-- frozen. The Free Review status endpoint reads the same two tables the
-- same way.
--
-- The sort column is included so the index also satisfies the ORDER BY
-- rather than forcing a separate sort of the matched rows.
--
-- Written as plain CREATE INDEX inside the migration transaction rather
-- than CONCURRENTLY (which cannot run in a transaction): these tables hold
-- on the order of a thousand rows, so the build is milliseconds and the
-- brief write lock is not a production risk at this size.

CREATE INDEX IF NOT EXISTS evidence_items_tenant_asset_idx
  ON evidence_items (tenant_id, asset_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS scan_findings_tenant_asset_idx
  ON scan_findings (tenant_id, asset_id, detected_at DESC);

-- The repository workers reconcile a completed run by job: see
-- osv-worker.ts's final_findings_hash query
-- (SELECT ... FROM scan_findings WHERE job_id=$1 AND tenant_id=$2).
CREATE INDEX IF NOT EXISTS scan_findings_job_idx
  ON scan_findings (job_id, tenant_id);

COMMIT;
