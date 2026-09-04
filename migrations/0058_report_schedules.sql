BEGIN;

CREATE TABLE IF NOT EXISTS report_schedules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  report_type text NOT NULL DEFAULT 'executive',
  cadence text NOT NULL CHECK (cadence IN ('weekly','monthly')),
  recipient_emails text NOT NULL DEFAULT '[]',
  next_run_at timestamp NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamp,
  last_error text,
  created_by text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON report_schedules (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS report_schedules_tenant_idx ON report_schedules (tenant_id, created_at DESC);
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON report_schedules;
CREATE POLICY spr_tenant_isolation ON report_schedules USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS spr_worker_cross_tenant ON report_schedules;
CREATE POLICY spr_worker_cross_tenant ON report_schedules FOR ALL TO spr_worker_runtime USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');

ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS attachments_json text;

COMMIT;
