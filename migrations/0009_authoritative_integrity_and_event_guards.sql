BEGIN;

-- The application/Drizzle schema defines remediation as operational state, but
-- the original base SQL schema did not create these tables. 0009 must therefore
-- establish the tables before installing database-enforced integrity triggers.
-- This is idempotent so it is safe for fresh installs and for databases where
-- the tables were already created out-of-band.
CREATE TABLE IF NOT EXISTS remediation_tasks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  alert_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  assignee_id text,
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  completed_at text,
  ready_for_verification_at text,
  verified_at text,
  verification_job_id text
);

CREATE TABLE IF NOT EXISTS remediation_verifications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  client_id text NOT NULL,
  alert_id text NOT NULL,
  monitoring_configuration_id text NOT NULL,
  collector_job_id text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  observation_id text,
  evidence_ids text NOT NULL DEFAULT '[]',
  evaluator_version text,
  failure_reason text,
  created_at text NOT NULL,
  completed_at text
);

CREATE INDEX IF NOT EXISTS remediation_tasks_tenant_alert
  ON remediation_tasks (tenant_id, alert_id, created_at DESC);
CREATE INDEX IF NOT EXISTS remediation_verifications_tenant_task
  ON remediation_verifications (tenant_id, task_id, created_at DESC);

-- Authoritative trust observations must be tenant-consistent, version-linked,
-- and append-only. Application checks remain defense in depth; these triggers
-- make the invariants database-enforced.
CREATE OR REPLACE FUNCTION spr_enforce_trust_observation_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_record record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM passports p WHERE p.id = NEW.passport_id AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Trust observation passport does not belong to tenant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Trust observation client does not belong to tenant';
  END IF;
  IF NEW.observation_version < 1 THEN
    RAISE EXCEPTION 'Trust observation version must be positive';
  END IF;

  IF NEW.previous_observation_id IS NULL THEN
    IF NEW.observation_version <> 1 THEN
      RAISE EXCEPTION 'First trust observation must have version 1';
    END IF;
  ELSE
    SELECT id, tenant_id, passport_id, observation_version
      INTO previous_record
      FROM trust_observations
     WHERE id = NEW.previous_observation_id;
    IF previous_record.id IS NULL
       OR previous_record.tenant_id <> NEW.tenant_id
       OR previous_record.passport_id <> NEW.passport_id
       OR NEW.observation_version <> previous_record.observation_version + 1 THEN
      RAISE EXCEPTION 'Trust observation chain is invalid';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_trust_observation_integrity ON trust_observations;
CREATE TRIGGER spr_trust_observation_integrity
BEFORE INSERT OR UPDATE OR DELETE ON trust_observations
FOR EACH ROW EXECUTE FUNCTION spr_enforce_trust_observation_integrity();

CREATE UNIQUE INDEX IF NOT EXISTS trust_observations_tenant_passport_idempotency
  ON trust_observations (tenant_id, passport_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION spr_enforce_trust_change_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM trust_observations o
    WHERE o.id = NEW.observation_id
      AND o.tenant_id = NEW.tenant_id
      AND o.passport_id = NEW.passport_id
  ) THEN
    RAISE EXCEPTION 'Trust observation change does not belong to observation tenant/passport';
  END IF;
  IF NEW.previous_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM trust_observations o
    WHERE o.id = NEW.previous_observation_id AND o.tenant_id = NEW.tenant_id AND o.passport_id = NEW.passport_id
  ) THEN
    RAISE EXCEPTION 'Previous trust observation does not belong to tenant/passport';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_trust_change_integrity ON trust_observation_changes;
CREATE TRIGGER spr_trust_change_integrity
BEFORE INSERT OR UPDATE ON trust_observation_changes
FOR EACH ROW EXECUTE FUNCTION spr_enforce_trust_change_integrity();

-- Remediation work is operational state, never evidence. Keep every reference
-- inside one tenant and require the originating alert/client relationship.
CREATE OR REPLACE FUNCTION spr_enforce_remediation_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'remediation_tasks' THEN
    IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation task client does not belong to tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM alerts a WHERE a.id = NEW.alert_id AND a.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation task alert does not belong to tenant';
    END IF;
  ELSIF TG_TABLE_NAME = 'remediation_verifications' THEN
    IF NOT EXISTS (SELECT 1 FROM remediation_tasks t WHERE t.id = NEW.task_id AND t.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation verification task does not belong to tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM alerts a WHERE a.id = NEW.alert_id AND a.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation verification alert does not belong to tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation verification client does not belong to tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM monitoring_configurations m WHERE m.id = NEW.monitoring_configuration_id AND m.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation verification monitoring configuration does not belong to tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM collector_jobs j WHERE j.id = NEW.collector_job_id AND j.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Remediation verification collector job does not belong to tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_remediation_task_integrity ON remediation_tasks;
CREATE TRIGGER spr_remediation_task_integrity BEFORE INSERT OR UPDATE ON remediation_tasks FOR EACH ROW EXECUTE FUNCTION spr_enforce_remediation_integrity();
DROP TRIGGER IF EXISTS spr_remediation_verification_integrity ON remediation_verifications;
CREATE TRIGGER spr_remediation_verification_integrity BEFORE INSERT OR UPDATE ON remediation_verifications FOR EACH ROW EXECUTE FUNCTION spr_enforce_remediation_integrity();

-- Delivery rows cannot be attached to another tenant's webhook and cannot carry
-- an arbitrary event type even if an internal caller bypasses the HTTP schema.
CREATE OR REPLACE FUNCTION spr_enforce_webhook_delivery_ownership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM spr_webhooks w WHERE w.id = NEW.webhook_id AND w.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Webhook delivery does not belong to webhook tenant';
  END IF;
  IF NEW.event_type NOT IN ('passport.updated','trust.changed','risk.created','risk.resolved','evidence.updated','verification.completed','verification.expired') THEN
    RAISE EXCEPTION 'Unsupported webhook event type';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_webhook_delivery_ownership ON spr_webhook_deliveries;
CREATE TRIGGER spr_webhook_delivery_ownership
BEFORE INSERT OR UPDATE ON spr_webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION spr_enforce_webhook_delivery_ownership();

COMMIT;
