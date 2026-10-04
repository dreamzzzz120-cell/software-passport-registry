BEGIN;

-- 0127: keep scan_file_inventory sustainable under repeated repository scans.
-- Four broad secondary indexes consumed more disk than the table itself in
-- production and overlapped with the scan_id/sequence uniqueness path. Keep
-- only indexes that support active UI filters/parent traversal, and add one
-- narrow retention index so bounded cleanup stays cheap as the table grows.
DROP INDEX IF EXISTS public.idx_sfi_tenant_passport_path;
DROP INDEX IF EXISTS public.idx_sfi_tenant_scan_path;
DROP INDEX IF EXISTS public.idx_sfi_tenant_scan_sha;
DROP INDEX IF EXISTS public.idx_sfi_tenant_scan_seq;

CREATE INDEX IF NOT EXISTS idx_sfi_updated_at
  ON public.scan_file_inventory(updated_at);

COMMIT;
