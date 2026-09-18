BEGIN;

-- 0103: complete the durable file ledger contract.
-- Additive only; no historical success states are invented.
ALTER TABLE public.scan_file_ledger
  ADD COLUMN IF NOT EXISTS disposition_status text NOT NULL DEFAULT 'DISCOVERED',
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS classification_method text,
  ADD COLUMN IF NOT EXISTS is_archive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archive_depth integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applicable_to_analysis boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS scan_file_ledger_disposition
  ON public.scan_file_ledger (scan_id, disposition_status, category);

CREATE INDEX IF NOT EXISTS scan_file_ledger_archive
  ON public.scan_file_ledger (scan_id, parent_archive_id, archive_depth);

CREATE INDEX IF NOT EXISTS scan_file_ledger_analysis
  ON public.scan_file_ledger (scan_id, applicable_to_analysis, analysis_status);

-- Application access is tenant-scoped through app.tenant_id.
-- Worker access is intentionally broader because the worker queue is
-- cross-tenant and the worker role is separately credentialed.
DROP POLICY IF EXISTS spr_tenant_isolation ON public.scan_file_ledger;
CREATE POLICY spr_tenant_isolation
  ON public.scan_file_ledger
  FOR ALL TO spr_app_runtime
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
