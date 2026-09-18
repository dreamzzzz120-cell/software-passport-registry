BEGIN;

-- 0102: make every production scan a durable root event and attach all
-- asynchronous artifacts to it. Additive only: existing scans/jobs/evidence
-- remain intact and nullable links preserve old history.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS software_identity text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS declared_scope text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS started_at timestamp,
  ADD COLUMN IF NOT EXISTS completed_at timestamp,
  ADD COLUMN IF NOT EXISTS job_id text,
  ADD COLUMN IF NOT EXISTS worker_job_id text,
  ADD COLUMN IF NOT EXISTS scanner_name text,
  ADD COLUMN IF NOT EXISTS scanner_version text,
  ADD COLUMN IF NOT EXISTS coverage_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS error_state text,
  ADD COLUMN IF NOT EXISTS error_code text;

ALTER TABLE public.agent_jobs
  ADD COLUMN IF NOT EXISTS scan_id text;

ALTER TABLE public.evidence_items
  ADD COLUMN IF NOT EXISTS scan_id text,
  ADD COLUMN IF NOT EXISTS job_id text;

ALTER TABLE public.scan_findings
  ADD COLUMN IF NOT EXISTS scan_id text;

CREATE TABLE IF NOT EXISTS public.scan_file_ledger (
  id text PRIMARY KEY,
  scan_id text NOT NULL REFERENCES public.scans(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  client_id text,
  software_identity text,
  parent_archive_id text,
  path text NOT NULL,
  filename text NOT NULL,
  size_bytes bigint,
  sha256 text,
  detected_type text,
  category text NOT NULL DEFAULT 'unknown',
  discovered_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inspection_status text NOT NULL DEFAULT 'discovered',
  analysis_status text NOT NULL DEFAULT 'not_analyzed',
  scanner_tool text,
  scanner_version text,
  error_reason text,
  component_refs text NOT NULL DEFAULT '[]',
  finding_refs text NOT NULL DEFAULT '[]',
  evidence_refs text NOT NULL DEFAULT '[]',
  UNIQUE (scan_id, path)
);

CREATE INDEX IF NOT EXISTS scan_file_ledger_tenant_scan
  ON public.scan_file_ledger (tenant_id, scan_id, path);
CREATE INDEX IF NOT EXISTS scan_file_ledger_scan_status
  ON public.scan_file_ledger (scan_id, inspection_status, analysis_status);
CREATE INDEX IF NOT EXISTS agent_jobs_scan_id
  ON public.agent_jobs (tenant_id, scan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evidence_items_scan_id
  ON public.evidence_items (tenant_id, scan_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS scan_findings_scan_id
  ON public.scan_findings (tenant_id, scan_id, detected_at DESC);

-- Scan IDs are immutable identifiers. State may change; identity may not.
CREATE OR REPLACE FUNCTION public.prevent_scan_id_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'SCAN_ID_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scans_id_immutable ON public.scans;
CREATE TRIGGER scans_id_immutable
BEFORE UPDATE OF id ON public.scans
FOR EACH ROW EXECUTE FUNCTION public.prevent_scan_id_mutation();

-- Preserve tenant isolation for the new ledger. The existing application
-- connection enforces tenant_id at the route layer; workers receive an
-- explicit cross-tenant policy just like the existing worker-owned tables.
ALTER TABLE public.scan_file_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_file_ledger FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='scan_file_ledger'
      AND policyname='spr_worker_cross_tenant'
  ) THEN
    CREATE POLICY spr_worker_cross_tenant
      ON public.scan_file_ledger
      FOR ALL TO spr_worker_runtime
      USING (current_user='spr_worker_runtime')
      WITH CHECK (current_user='spr_worker_runtime');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scan_file_ledger TO spr_app_runtime, spr_worker_runtime;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='scan_file_ledger'
      AND policyname='spr_tenant_isolation'
  ) THEN
    CREATE POLICY spr_tenant_isolation
      ON public.scan_file_ledger
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $;

ALTER TABLE public.scan_file_ledger FORCE ROW LEVEL SECURITY;

COMMIT;
