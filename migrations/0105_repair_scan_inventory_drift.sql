BEGIN;

-- 0105: repair production drift where 0104 was recorded as applied but its
-- durable inventory/coverage objects were not present. Fully idempotent.
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS passport_id text,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS resolved_commit_sha text,
  ADD COLUMN IF NOT EXISTS intake_job_id text,
  ADD COLUMN IF NOT EXISTS intake_session_id text,
  ADD COLUMN IF NOT EXISTS passport_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS passport_failure text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.scan_findings
  ADD COLUMN IF NOT EXISTS file_path text;

CREATE TABLE IF NOT EXISTS public.scan_file_inventory (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  scan_id text NOT NULL REFERENCES public.scans(id) ON DELETE RESTRICT,
  passport_id text NOT NULL,
  client_id text,
  parent_file_id text,
  depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0),
  sequence integer NOT NULL CHECK (sequence >= 0),
  path text NOT NULL,
  filename text NOT NULL,
  extension text,
  detected_type text,
  detection_method text NOT NULL DEFAULT 'none' CHECK (detection_method IN ('magic','extension','filename','none')),
  category text NOT NULL DEFAULT 'unknown' CHECK (category IN (
    'dependency_manifest','lockfile','source_code','sbom','configuration','ci_cd','build_deployment',
    'binary','package','archive','documentation','license','test','infrastructure','data','unknown'
  )),
  size bigint CHECK (size IS NULL OR size >= 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  source text NOT NULL,
  is_archive integer NOT NULL DEFAULT 0 CHECK (is_archive IN (0,1)),
  archive_enumerated integer CHECK (archive_enumerated IS NULL OR archive_enumerated IN (0,1)),
  discovered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disposition text NOT NULL DEFAULT 'discovered' CHECK (disposition IN (
    'discovered','inventoried','classified','queued','inspected','partially_inspected','analyzed',
    'unsupported','skipped','failed','inaccessible','unknown'
  )),
  inspection_status text NOT NULL DEFAULT 'not_inspected' CHECK (inspection_status IN ('inspected','partial','not_inspected','failed')),
  analysis_status text NOT NULL DEFAULT 'not_analyzed' CHECK (analysis_status IN ('analyzed','not_analyzed','failed')),
  inspection_level text,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_code text,
  reason_detail text,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_finding_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scan_id, sequence)
);

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
  inspection_applicable integer NOT NULL DEFAULT 0,
  analysis_applicable integer NOT NULL DEFAULT 0,
  accounting_coverage_pct numeric(5,2),
  inspection_coverage_pct numeric(5,2),
  analysis_coverage_pct numeric(5,2),
  evidence_coverage_pct numeric(5,2),
  inventory_complete integer NOT NULL DEFAULT 0 CHECK (inventory_complete IN (0,1)),
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_seq ON public.scan_file_inventory(tenant_id, scan_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_disposition ON public.scan_file_inventory(tenant_id, scan_id, disposition);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_category ON public.scan_file_inventory(tenant_id, scan_id, category);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_inspection ON public.scan_file_inventory(tenant_id, scan_id, inspection_status);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_path ON public.scan_file_inventory(tenant_id, scan_id, path);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_passport_path ON public.scan_file_inventory(tenant_id, passport_id, path);
CREATE INDEX IF NOT EXISTS idx_sfi_tenant_scan_sha ON public.scan_file_inventory(tenant_id, scan_id, sha256);
CREATE INDEX IF NOT EXISTS idx_sfi_parent ON public.scan_file_inventory(parent_file_id);
CREATE INDEX IF NOT EXISTS idx_scan_coverage_tenant_passport ON public.scan_coverage(tenant_id, passport_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scans_passport_status_check') THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_passport_status_check
      CHECK (passport_status IN ('pending','associated','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scans_resolved_commit_sha_check') THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_resolved_commit_sha_check
      CHECK (resolved_commit_sha IS NULL OR resolved_commit_sha ~ '^[a-f0-9]{40}$');
  END IF;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['scan_file_inventory','scan_coverage']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND policyname='spr_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY spr_tenant_isolation ON public.%I FOR ALL TO spr_app_runtime USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND policyname='spr_worker_cross_tenant') THEN
        EXECUTE format('CREATE POLICY spr_worker_cross_tenant ON public.%I FOR ALL TO spr_worker_runtime USING (current_user=''spr_worker_runtime'') WITH CHECK (current_user=''spr_worker_runtime'')', tbl);
      END IF;
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO spr_worker_runtime', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO spr_app_runtime', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
