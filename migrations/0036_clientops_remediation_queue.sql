BEGIN;

-- ClientOps: trust_remediation_work_items already has the real status
-- machine (OPEN -> IN_PROGRESS -> READY_FOR_VERIFICATION -> VERIFIED/CLOSED)
-- and a real verify-against-evidence step (verifyRemediation), but there
-- was no client_id column on it at all (only the separate, parallel
-- remediation_tasks table has one, via finding.client_id at creation time
-- -- and remediation_tasks.status is never updated again after PATCH
-- /remediations/:id, so it silently goes stale; that pre-existing
-- duplication is left alone here, not fixed, since untangling two
-- overlapping tables is a bigger, separate change). Every other
-- tenant-scoped operational table in this app carries its own client_id
-- for scoping; this one didn't, so there was no way to list/filter
-- remediations by client, and no GET /remediations list endpoint existed
-- at all -- only create-one and patch-one-by-id.
ALTER TABLE trust_remediation_work_items ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE trust_remediation_work_items ADD COLUMN IF NOT EXISTS client_approved_at timestamp;
ALTER TABLE trust_remediation_work_items ADD COLUMN IF NOT EXISTS client_approved_by text;
CREATE INDEX IF NOT EXISTS trust_remediation_work_items_client_idx ON trust_remediation_work_items (tenant_id, client_id, status);

-- A real, append-only note thread on a remediation task. Previously the
-- only text on a task was its description, fixed once at creation --
-- there was no way to record ongoing collaboration (a technician leaving
-- an update, a client asking a question) at all.
CREATE TABLE IF NOT EXISTS remediation_notes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  remediation_id text NOT NULL REFERENCES trust_remediation_work_items(id) ON DELETE CASCADE,
  author_uid text NOT NULL,
  author_display text NOT NULL,
  body text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS remediation_notes_remediation_idx ON remediation_notes (tenant_id, remediation_id, created_at);

CREATE OR REPLACE FUNCTION spr_enforce_remediation_note_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REMEDIATION_NOTE_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trust_remediation_work_items w WHERE w.id = NEW.remediation_id AND w.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Remediation note does not belong to the referenced remediation''s tenant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_remediation_note_immutable ON remediation_notes;
CREATE TRIGGER spr_remediation_note_immutable BEFORE INSERT OR UPDATE OR DELETE ON remediation_notes
FOR EACH ROW EXECUTE FUNCTION spr_enforce_remediation_note_immutable();

DO $$
BEGIN
  EXECUTE 'ALTER TABLE remediation_notes ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'remediation_notes' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON remediation_notes USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT ON remediation_notes TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT ON remediation_notes TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
