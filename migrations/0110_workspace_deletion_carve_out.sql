BEGIN;

-- Five tables are append-only audit trails whose triggers reject every
-- DELETE: login_history, trust_observations, vendor_audits,
-- remediation_notes and remediation_task_transitions. That is right for
-- every ordinary code path, and stays so. It also meant a workspace could
-- never be deleted: the first live DELETE /api/organization (2026-09-19
-- 06:16Z) was refused with LOGIN_HISTORY_IMMUTABLE and, correctly, rolled
-- everything back.
--
-- This migration carves out exactly one transition: a row may be deleted
-- while the deleting transaction has declared, with
--   SELECT set_config('app.workspace_deletion', <tenant_id>, true)
-- that it is deleting that specific workspace, and the row belongs to that
-- tenant. The setting is transaction-local, is only ever set by the
-- workspace-deletion route, and a row of any other tenant is still refused.
-- UPDATEs and every other rule in these functions are unchanged.

CREATE OR REPLACE FUNCTION spr_workspace_deletion_in_progress(row_tenant_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT row_tenant_id IS NOT NULL
     AND current_setting('app.workspace_deletion', true) IS NOT NULL
     AND current_setting('app.workspace_deletion', true) <> ''
     AND current_setting('app.workspace_deletion', true) = row_tenant_id
$$;

CREATE OR REPLACE FUNCTION spr_enforce_login_history_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF spr_workspace_deletion_in_progress(OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- The one permitted mutation: ON DELETE SET NULL firing when the
    -- referenced user is removed. Every other column must be byte-for-byte
    -- unchanged, and every other kind of update is still rejected.
    IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id
       AND NEW.occurred_at = OLD.occurred_at AND NEW.ip = OLD.ip
       AND NEW.user_agent = OLD.user_agent AND NEW.status = OLD.status THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Login history entry does not belong to the referenced user''s tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION spr_enforce_trust_observation_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_record record;
BEGIN
  IF TG_OP = 'DELETE' AND spr_workspace_deletion_in_progress(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM passports p WHERE p.id = NEW.passport_id AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Trust observation passport does not belong to tenant';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id) THEN
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

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION spr_enforce_vendor_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND spr_workspace_deletion_in_progress(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VENDOR_AUDIT_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id = NEW.vendor_id AND v.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Vendor audit does not belong to the referenced vendor''s tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION spr_enforce_remediation_note_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND spr_workspace_deletion_in_progress(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REMEDIATION_NOTE_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trust_remediation_work_items w WHERE w.id = NEW.remediation_id AND w.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Remediation note does not belong to the referenced remediation''s tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION spr_enforce_remediation_transition_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND spr_workspace_deletion_in_progress(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REMEDIATION_TASK_TRANSITION_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trust_remediation_work_items w WHERE w.id = NEW.task_id AND w.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Remediation task transition does not belong to the referenced task''s tenant';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
