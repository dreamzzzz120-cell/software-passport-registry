BEGIN;

-- Zero-file-loss scan infrastructure, built on the durable scan root that
-- 0102 introduced (scans.id is the stable id every job, finding and evidence
-- record points at through scan_id).
--
-- Before 0102 a scan left no per-file record anywhere; 0102/0103 added
-- scan_file_ledger, written by the security worker as one row per file path
-- with a single disposition. That table cannot express what this migration
-- needs and is superseded (left in place, no longer written):
--
--   * UNIQUE (scan_id, path) collapses duplicate path occurrences, which the
--     ledger must preserve;
--   * one writer overwrote the other's verdict -- the repository job's
--     catalog result and the security job's content result for the same file
--     need to MERGE, not race;
--   * the discovery source was the extracted tree, not the archive listing,
--     so an entry that failed to extract was never recorded at all.
--
-- scan_file_inventory keeps one row per discovered file per scan, keyed by
-- discovery sequence, with an explicit disposition, inspection status and
-- analysis status, the tool that produced each, the reason nothing did, and
-- links to the components, findings and evidence that reference the file.
-- scan_coverage stores the accounting per scan: discovered / accounted for /
-- inspected / partial / analyzed / unsupported / skipped / failed /
-- inaccessible / with findings / without findings, plus four SEPARATE
-- coverage ratios with their denominators. They are never collapsed into one
-- percentage.

-- The scan root gains what the ledger needs to answer "which software, which
-- client, which commit, did the passport update succeed?".
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS passport_id text,
  ADD COLUMN IF NOT EXISTS client_id text,
  -- Human-readable source reference: "owner/repository@ref[:subdir]" or
  -- "intake:<session id>" or "passport:<id>". Never a server path.
  ADD COLUMN IF NOT EXISTS source_ref text,
  -- The exact commit both halves of a repository scan examine. The first job
  -- to resolve the ref pins it; the second reads it back rather than resolving
  -- again, so a push between the two jobs cannot make them describe different
  -- trees under one scan id.
  ADD COLUMN IF NOT EXISTS resolved_commit_sha text,
  ADD COLUMN IF NOT EXISTS intake_job_id text,
  ADD COLUMN IF NOT EXISTS intake_session_id text,
  -- Passport association outcome, recorded separately from the scan outcome:
  -- a scan whose evidence persisted but whose passport upsert failed is
  -- 'failed' HERE and still 'Completed' as a scan.
  ADD COLUMN IF NOT EXISTS passport_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS passport_failure text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_passport_status_check') THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_passport_status_check CHECK (passport_status IN ('pending', 'associated', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_resolved_commit_sha_check') THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_resolved_commit_sha_check CHECK (resolved_commit_sha IS NULL OR resolved_commit_sha ~ '^[a-f0-9]{40}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scans_tenant_created ON public.scans(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_tenant_passport ON public.scans(tenant_id, passport_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_tenant_client ON public.scans(tenant_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_tenant_status ON public.scans(tenant_id, status);

-- Findings gain the file they were observed in, so FINDING -> FILE is a column
-- rather than a sentence in the description.
ALTER TABLE public.scan_findings ADD COLUMN IF NOT EXISTS file_path text;

CREATE TABLE IF NOT EXISTS public.scan_file_inventory (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  scan_id text NOT NULL REFERENCES public.scans(id) ON DELETE RESTRICT,
  passport_id text NOT NULL,
  client_id text,
  -- The archive or upload this entry was enumerated from. NULL for a top-level
  -- entry of the acquired tree; a nested archive's children point at the
  -- archive's own inventory row.
  parent_file_id text,
  depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0),
  -- Discovery order within the scan. Two entries with the same path (a
  -- duplicate inside an archive listing, or the same relative path inside two
  -- different nested archives) are two rows. Unique per scan so a retried job
  -- updates the row it wrote before instead of inserting it again.
  sequence integer NOT NULL CHECK (sequence >= 0),
  path text NOT NULL,
  filename text NOT NULL,
  extension text,
  detected_type text,
  -- How detected_type was determined: 'magic' (bytes read), 'extension',
  -- 'filename' or 'none'. A type is never claimed without saying how.
  detection_method text NOT NULL DEFAULT 'none' CHECK (detection_method IN ('magic', 'extension', 'filename', 'none')),
  category text NOT NULL DEFAULT 'unknown' CHECK (category IN (
    'dependency_manifest', 'lockfile', 'source_code', 'sbom', 'configuration', 'ci_cd', 'build_deployment',
    'binary', 'package', 'archive', 'documentation', 'license', 'test', 'infrastructure', 'data', 'unknown'
  )),
  size bigint CHECK (size IS NULL OR size >= 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  -- 'github-archive', 'intake-upload' or 'nested-archive'.
  source text NOT NULL,
  is_archive integer NOT NULL DEFAULT 0 CHECK (is_archive IN (0, 1)),
  -- NULL = not an archive; 1 = its listing was read; 0 = it could not be enumerated (reason_code says why).
  archive_enumerated integer CHECK (archive_enumerated IS NULL OR archive_enumerated IN (0, 1)),
  discovered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The explicit disposition every known file must carry. 'discovered' is the
  -- initial state and counts as NOT accounted for.
  disposition text NOT NULL DEFAULT 'discovered' CHECK (disposition IN (
    'discovered', 'inventoried', 'classified', 'queued', 'inspected', 'partially_inspected', 'analyzed',
    'unsupported', 'skipped', 'failed', 'inaccessible', 'unknown'
  )),
  inspection_status text NOT NULL DEFAULT 'not_inspected' CHECK (inspection_status IN ('inspected', 'partial', 'not_inspected', 'failed')),
  analysis_status text NOT NULL DEFAULT 'not_analyzed' CHECK (analysis_status IN ('analyzed', 'not_analyzed', 'failed')),
  -- What "inspected" meant for this file: 'content' (bytes were read and
  -- scanned), 'catalog' (a package cataloger parsed it), 'listing' (its name
  -- and size were observed in an archive listing and nothing more),
  -- 'extracted' (an uploaded archive whose members were each recorded).
  inspection_level text,
  -- [{ "name": "spr-secret-scanner-v1", "version": "1", "action": "content" }, ...]
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Machine-readable reason for unsupported/skipped/failed/inaccessible.
  reason_code text,
  reason_detail text,
  -- Every contribution from every job, so a merged row still shows what each
  -- engine actually did or did not do with the file.
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_finding_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scan_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_seq ON public.scan_file_inventory(tenant_id, scan_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_disposition ON public.scan_file_inventory(tenant_id, scan_id, disposition);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_category ON public.scan_file_inventory(tenant_id, scan_id, category);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_inspection ON public.scan_file_inventory(tenant_id, scan_id, inspection_status);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_path ON public.scan_file_inventory(tenant_id, scan_id, path);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_passport_path ON public.scan_file_inventory(tenant_id, passport_id, path);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_sha ON public.scan_file_inventory(tenant_id, scan_id, sha256);
CREATE INDEX IF NOT EXISTS idx_sfi_parent ON public.scan_file_inventory(parent_file_id);

CREATE TABLE IF NOT EXISTS public.scan_coverage (
  scan_id text PRIMARY KEY REFERENCES public.scans(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  files_discovered integer NOT NULL DEFAULT 0,
  files_accounted_for integer NOT NULL DEFAULT 0,
  files_inspected integer NOT NULL DEFAULT 0,
  files_partially_inspected integer NOT NULL DEFAULT 0,
  files_analyzed integer NOT NULL DEFAULT 0,
  files_unsupported integer NOT NULL DEFAULT 0,
  files_skipped integer NOT NULL DEFAULT 0,
  files_failed integer NOT NULL DEFAULT 0,
  files_inaccessible integer NOT NULL DEFAULT 0,
  files_unknown integer NOT NULL DEFAULT 0,
  files_with_findings integer NOT NULL DEFAULT 0,
  files_without_findings integer NOT NULL DEFAULT 0,
  files_with_evidence integer NOT NULL DEFAULT 0,
  archives_discovered integer NOT NULL DEFAULT 0,
  archives_enumerated integer NOT NULL DEFAULT 0,
  archives_unreadable integer NOT NULL DEFAULT 0,
  -- Denominators are stored beside the ratios so no percentage is ever shown
  -- without the count it was computed from.
  inspection_applicable integer NOT NULL DEFAULT 0,
  analysis_applicable integer NOT NULL DEFAULT 0,
  accounting_coverage_pct numeric(5,2),
  inspection_coverage_pct numeric(5,2),
  analysis_coverage_pct numeric(5,2),
  evidence_coverage_pct numeric(5,2),
  -- 1 when the discovery source (archive listing / intake session) was fully
  -- enumerated; 0 when a limit truncated it, in which case files_discovered is
  -- a lower bound and the limitation is listed.
  inventory_complete integer NOT NULL DEFAULT 0 CHECK (inventory_complete IN (0, 1)),
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scan_coverage_tenant_passport ON public.scan_coverage(tenant_id, passport_id);

-- Uploaded-file scans: the intake session a scan consumes. Until now an intake
-- session was claimed, its items marked QUEUED, and nothing consumed them --
-- the UI reported the files as "queued for SPR analysis" while no analysis
-- existed.
CREATE TABLE IF NOT EXISTS public.intake_scan_sources (
  id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE,
  scan_id text NOT NULL REFERENCES public.scans(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  session_id text NOT NULL REFERENCES public.intake_sessions(id) ON DELETE RESTRICT,
  item_count integer NOT NULL DEFAULT 0,
  acquired_at timestamptz,
  scanner_error_category text,
  temporary_directory_removed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_intake_scan_sources_tenant ON public.intake_scan_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_intake_scan_sources_session ON public.intake_scan_sources(session_id);

-- Tenant isolation contract (same shape as 0048/0056): RLS enabled and forced,
-- the app role confined to app.tenant_id, the worker role given its explicit
-- cross-tenant policy, and least-privilege DML grants.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['scan_file_inventory', 'scan_coverage', 'intake_scan_sources']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'spr_tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'spr_worker_cross_tenant') THEN
        EXECUTE format(
          'CREATE POLICY spr_worker_cross_tenant ON %I FOR ALL TO spr_worker_runtime USING (current_user = ''spr_worker_runtime'') WITH CHECK (current_user = ''spr_worker_runtime'')',
          tbl
        );
      END IF;
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_worker_runtime', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_app_runtime', tbl);
    END IF;
  END LOOP;
END $$;

-- Fail the release here rather than letting /ready discover it later.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name)
    INTO missing
  FROM information_schema.columns c
  JOIN pg_class r ON r.relname = c.table_name
  JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id'
    AND r.relkind = 'r'
    AND (NOT r.relrowsecurity OR NOT r.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TENANT_RLS_NOT_HARDENED after 0104:%', missing;
  END IF;
END $$;

COMMIT;
