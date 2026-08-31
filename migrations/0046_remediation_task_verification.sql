BEGIN;

-- MSPCommandCenter.tsx has always shipped a full remediation-task workflow
-- UI (create -> start -> ready-for-verification -> queue verification ->
-- poll -> verified/failed) but no backend route ever existed at
-- /api/remediation-tasks: it silently 404'd for every tenant, always. A
-- competing dead schema (remediation_tasks/remediation_verifications,
-- migration 0009) was built for the same purpose but never wired up either,
-- and its alert_id FK points at the `alerts` table, which nothing in this
-- codebase has ever inserted a row into -- building on it would just be a
-- second dead schema. trust_remediation_work_items is the real, live,
-- already-used remediation table (routes/trust-loop.ts, reports, the
-- evidence ledger); this extends it with exactly what task-level
-- verification tracking needs, rather than introducing a parallel table.
ALTER TABLE trust_remediation_work_items DROP CONSTRAINT IF EXISTS trust_remediation_work_items_status_check;
ALTER TABLE trust_remediation_work_items ADD CONSTRAINT trust_remediation_work_items_status_check
  CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','READY_FOR_VERIFICATION','VERIFICATION_QUEUED','VERIFYING','VERIFIED','VERIFICATION_FAILED','CLOSED','CANCELLED'));

ALTER TABLE trust_remediation_work_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS started_at text,
  ADD COLUMN IF NOT EXISTS ready_for_verification_at text,
  ADD COLUMN IF NOT EXISTS verification_configuration_id text,
  ADD COLUMN IF NOT EXISTS verification_job_id text,
  ADD COLUMN IF NOT EXISTS verified_at text,
  ADD COLUMN IF NOT EXISTS verification_result text,
  ADD COLUMN IF NOT EXISTS verification_failure_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trust_remediation_verification_config_tenant_fk') THEN
    ALTER TABLE trust_remediation_work_items
      ADD CONSTRAINT trust_remediation_verification_config_tenant_fk FOREIGN KEY (tenant_id, verification_configuration_id) REFERENCES monitoring_configurations(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trust_remediation_verification_job_tenant_fk') THEN
    ALTER TABLE trust_remediation_work_items
      ADD CONSTRAINT trust_remediation_verification_job_tenant_fk FOREIGN KEY (tenant_id, verification_job_id) REFERENCES collector_jobs(tenant_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS trust_remediation_verification_job_idx
  ON trust_remediation_work_items (tenant_id, verification_job_id) WHERE verification_job_id IS NOT NULL;

-- Immutable, append-only record of every status change a task goes through --
-- the auditable history the state machine itself is checked against, mirroring
-- remediation_notes' immutability pattern (migration 0036).
CREATE TABLE IF NOT EXISTS remediation_task_transitions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  task_id text NOT NULL REFERENCES trust_remediation_work_items(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_id text,
  occurred_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS remediation_task_transitions_scope ON remediation_task_transitions (tenant_id, task_id, occurred_at);

CREATE OR REPLACE FUNCTION spr_enforce_remediation_transition_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REMEDIATION_TASK_TRANSITION_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trust_remediation_work_items w WHERE w.id = NEW.task_id AND w.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Remediation task transition does not belong to the referenced task''s tenant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_remediation_transition_immutable ON remediation_task_transitions;
CREATE TRIGGER spr_remediation_transition_immutable BEFORE INSERT OR UPDATE OR DELETE ON remediation_task_transitions
FOR EACH ROW EXECUTE FUNCTION spr_enforce_remediation_transition_immutable();

DO $$
BEGIN
  EXECUTE 'ALTER TABLE remediation_task_transitions ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'remediation_task_transitions' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON remediation_task_transitions USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT ON remediation_task_transitions TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT ON remediation_task_transitions TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
