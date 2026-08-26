BEGIN;

-- Compliance verification schedules: src/components/ComplianceView.tsx has
-- shipped a full frontend against /api/compliance/schedules for a while
-- with no backend route ever built for it. This is that backend.
--
-- There is no scheduler anywhere in this codebase (confirmed: the closest
-- analog, scan_schedules, stores a computed next_run_at that nothing ever
-- polls) and no email/SMTP integration exists to notify target_email.
-- "Run" is therefore a real, manual, on-demand trigger only -- next_audit_at
-- is informational display data, same as scan_schedules.next_run_at, not a
-- cron input. Do not build a worker that consumes it without adding a real
-- delivery mechanism to match; that would silently reintroduce exactly the
-- kind of gap this migration exists to close honestly.
CREATE TABLE IF NOT EXISTS compliance_schedules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('Daily','Weekly','Monthly')),
  target_email text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Paused')),
  last_audit_at text,
  next_audit_at text NOT NULL,
  created_by text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS compliance_schedules_tenant_scope ON compliance_schedules(tenant_id, client_id, status);

-- Enable the same defense-in-depth Row-Level Security every other
-- tenant-scoped table has (migration 0020) -- new tables do not inherit it
-- automatically, only ones that existed when that migration's loop ran.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE compliance_schedules ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'compliance_schedules' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON compliance_schedules USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_schedules TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_schedules TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
