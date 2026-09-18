BEGIN;

-- Zero-file-loss scan infrastructure.
--
-- Before this migration a scan left no per-file record anywhere. The
-- repository worker enumerated the acquired archive, kept the manifest paths
-- and threw the rest of the listing away; the content scanners read text files
-- under 2 MB outside a fixed set of ignored directories and never said which
-- files they did not read. A customer could not answer "what did SPR actually
-- inspect?" or "what could SPR not inspect?" -- the honest answer was that the
-- system did not know.
--
-- Three tables close that gap:
--
--   scan_runs             the scan ledger. One row per submitted scan, keyed by
--                         a stable id assigned BEFORE any processing begins and
--                         carrying the tenant, client and software identity the
--                         scan belongs to. It outlives passport generation: a
--                         passport failure is recorded on this row, never by
--                         deleting it.
--   scan_file_inventory   one row per known file per scan, with an explicit
--                         disposition, inspection status and analysis status.
--                         Duplicate path occurrences are preserved (sequence),
--                         nested archive children carry their parent's file id,
--                         and every row names the tool that touched it or the
--                         reason nothing did.
--   scan_coverage         the per-scan accounting: discovered / accounted for /
--                         inspected / partial / analyzed / unsupported /
--                         skipped / failed / inaccessible / with findings /
--                         without findings, plus four SEPARATE coverage ratios.
--                         They are never collapsed into one percentage.
--
-- The legacy `scans` table stays the customer-facing list; it gains a link to
-- the ledger so a row created at submission is the row the worker completes,
-- instead of the worker inserting a second, unrelated row and the first one
-- reading "Scanning" forever (observed in production before this migration).

CREATE TABLE IF NOT EXISTS scan_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text,
  passport_id text NOT NULL,
  -- 'github' (public or tenant-credentialed repository) or 'upload' (universal
  -- intake session) or 'sbom' (an OSV query over a passport's persisted SBOM,
  -- which has no file inventory). Nothing else is accepted by the workers.
  source_kind text NOT NULL CHECK (source_kind IN ('github', 'upload', 'sbom')),
  -- Human-readable source reference: "owner/repository@ref" or the intake
  -- session id. Never a server path.
  source_ref text NOT NULL,
  -- The exact commit both halves of a repository scan examine. The first job
  -- to resolve the ref pins it here; the second reads it back rather than
  -- resolving again, so a push between the two jobs cannot make them describe
  -- different trees under one scan id.
  resolved_commit_sha text CHECK (resolved_commit_sha IS NULL OR resolved_commit_sha ~ '^[a-f0-9]{40}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  repository_job_id text,
  security_job_id text,
  intake_job_id text,
  intake_session_id text,
  triggered_by text NOT NULL,
  failure_code text,
  -- Passport association outcome, recorded separately from the scan outcome:
  -- a scan whose evidence persisted but whose passport upsert or scoring failed
  -- is 'failed' HERE and still 'completed' as a scan.
  passport_status text NOT NULL DEFAULT 'pending' CHECK (passport_status IN ('pending', 'associated', 'failed')),
  passport_failure text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scan_runs_tenant_created ON scan_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_runs_tenant_passport ON scan_runs(tenant_id, passport_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_runs_tenant_client ON scan_runs(tenant_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_runs_tenant_status ON scan_runs(tenant_id, status);

ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS scan_run_id text;
CREATE INDEX IF NOT EXISTS idx_agent_jobs_scan_run ON agent_jobs(scan_run_id);

ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_run_id text;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS passport_id text;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS failure_code text;
CREATE INDEX IF NOT EXISTS idx_scans_scan_run ON scans(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_scans_tenant_passport ON scans(tenant_id, passport_id);

-- Findings gain the file they were observed in, so FINDING -> FILE is a column
-- rather than a sentence in the description.
ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS scan_run_id text;
CREATE INDEX IF NOT EXISTS idx_scan_findings_scan_run ON scan_findings(scan_run_id);

ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS scan_run_id text;
CREATE INDEX IF NOT EXISTS idx_evidence_items_scan_run ON evidence_items(scan_run_id);

CREATE TABLE IF NOT EXISTS scan_file_inventory (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  scan_run_id text NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT,
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
  -- and size were observed in an archive listing and nothing more).
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
  UNIQUE (scan_run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_run_seq ON scan_file_inventory(tenant_id, scan_run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_run_disposition ON scan_file_inventory(tenant_id, scan_run_id, disposition);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_run_category ON scan_file_inventory(tenant_id, scan_run_id, category);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_run_inspection ON scan_file_inventory(tenant_id, scan_run_id, inspection_status);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_run_path ON scan_file_inventory(tenant_id, scan_run_id, path);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_passport_path ON scan_file_inventory(tenant_id, passport_id, path);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_run_sha ON scan_file_inventory(tenant_id, scan_run_id, sha256);
CREATE INDEX IF NOT EXISTS idx_sfi_parent ON scan_file_inventory(parent_file_id);

CREATE TABLE IF NOT EXISTS scan_coverage (
  scan_run_id text PRIMARY KEY REFERENCES scan_runs(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS idx_scan_coverage_tenant_passport ON scan_coverage(tenant_id, passport_id);

-- Uploaded-file scans: the intake session a scan run consumes. Until now an
-- intake session was claimed, its items marked QUEUED, and nothing consumed
-- them -- the UI reported the files as "queued for SPR analysis" while no
-- analysis existed.
CREATE TABLE IF NOT EXISTS intake_scan_sources (
  id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE,
  scan_run_id text NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  session_id text NOT NULL REFERENCES intake_sessions(id) ON DELETE RESTRICT,
  item_count integer NOT NULL DEFAULT 0,
  acquired_at timestamptz,
  scanner_error_category text,
  temporary_directory_removed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_intake_scan_sources_tenant ON intake_scan_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_intake_scan_sources_session ON intake_scan_sources(session_id);

-- Tenant isolation contract (same shape as 0048/0056): RLS enabled and forced,
-- the app role confined to app.tenant_id, the worker role given its explicit
-- cross-tenant policy, and least-privilege DML grants.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['scan_runs', 'scan_file_inventory', 'scan_coverage', 'intake_scan_sources']
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
    RAISE EXCEPTION 'TENANT_RLS_NOT_HARDENED after 0102:%', missing;
  END IF;
END $$;

COMMIT;
