BEGIN;

-- Trust Response: security-questionnaire automation. Unlike the audit/
-- observation ledgers elsewhere in this app, a questionnaire item is a
-- living document (draft -> reviewed -> approved), not an immutable
-- record -- editing and re-running the matcher as evidence changes is the
-- intended workflow, so there is no append-only trigger here.
CREATE TABLE IF NOT EXISTS questionnaires (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','EXPORTED')),
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS questionnaires_tenant_idx ON questionnaires (tenant_id, client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS questionnaire_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  questionnaire_id text NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL,
  question_text text NOT NULL,
  category text,
  draft_answer text,
  confidence_basis_points integer NOT NULL DEFAULT 0,
  -- UNKNOWN: no evidence supports any answer (never fabricated).
  -- NEEDS_REVIEW: evidence exists but points to an open gap -- a human
  -- must decide how to phrase that before it goes out. ANSWERED: a draft
  -- exists from clean matching evidence. APPROVED: a human signed off.
  status text NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('UNKNOWN','NEEDS_REVIEW','ANSWERED','APPROVED')),
  evidence_ids text NOT NULL DEFAULT '[]',
  approved_by text,
  approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (questionnaire_id, sequence_number)
);
CREATE INDEX IF NOT EXISTS questionnaire_items_questionnaire_idx ON questionnaire_items (tenant_id, questionnaire_id, sequence_number);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE questionnaires ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'questionnaires' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON questionnaires USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
  EXECUTE 'ALTER TABLE questionnaire_items ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'questionnaire_items' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON questionnaire_items USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON questionnaires TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON questionnaire_items TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON questionnaires TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON questionnaire_items TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
