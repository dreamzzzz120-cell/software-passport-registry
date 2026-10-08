BEGIN;
CREATE TABLE IF NOT EXISTS growth_cell_controls (
 tenant_id text NOT NULL,cell_id text NOT NULL,
 state text NOT NULL DEFAULT 'observing' CHECK(state IN ('observing','paused','archived')),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,cell_id)
);
CREATE TABLE IF NOT EXISTS growth_cell_control_receipts (
 id text PRIMARY KEY,tenant_id text NOT NULL,cell_id text NOT NULL,actor_id text NOT NULL,
 previous_state text NOT NULL,next_state text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_cell_receipts_time_idx ON growth_cell_control_receipts(tenant_id,created_at DESC);
ALTER TABLE distribution_jobs DROP CONSTRAINT IF EXISTS distribution_jobs_kind_check;
ALTER TABLE distribution_jobs ADD CONSTRAINT distribution_jobs_kind_check CHECK(kind IN ('research_url','qualify_lead','prepare_outreach','send_outreach','followup_outreach','growth_cell'));
CREATE UNIQUE INDEX IF NOT EXISTS distribution_growth_cell_pending_idx ON distribution_jobs(tenant_id,(payload->>'cellId')) WHERE kind='growth_cell' AND status IN ('queued','running');
ALTER TABLE growth_cell_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_cell_controls FORCE ROW LEVEL SECURITY;
ALTER TABLE growth_cell_control_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_cell_control_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_tenant_isolation ON growth_cell_controls;
CREATE POLICY spr_tenant_isolation ON growth_cell_controls USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
DROP POLICY IF EXISTS spr_tenant_isolation ON growth_cell_control_receipts;
CREATE POLICY spr_tenant_isolation ON growth_cell_control_receipts USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
DROP POLICY IF EXISTS spr_worker_cross_tenant ON growth_cell_controls;
CREATE POLICY spr_worker_cross_tenant ON growth_cell_controls FOR SELECT TO spr_worker_runtime USING(current_user='spr_worker_runtime');
DROP POLICY IF EXISTS spr_worker_cross_tenant ON growth_cell_control_receipts;
CREATE POLICY spr_worker_cross_tenant ON growth_cell_control_receipts FOR SELECT TO spr_worker_runtime USING(current_user='spr_worker_runtime');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
 GRANT SELECT,INSERT,UPDATE ON growth_cell_controls TO spr_app_runtime;
 GRANT SELECT,INSERT ON growth_cell_control_receipts TO spr_app_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
 GRANT SELECT ON growth_cell_controls,growth_cell_control_receipts TO spr_worker_runtime;
 END IF;
END $$;
COMMIT;
