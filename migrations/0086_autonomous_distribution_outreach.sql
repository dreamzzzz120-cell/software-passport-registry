BEGIN;

ALTER TABLE distribution_jobs DROP CONSTRAINT IF EXISTS distribution_jobs_kind_check;
ALTER TABLE distribution_jobs ADD CONSTRAINT distribution_jobs_kind_check CHECK (kind IN ('research_url','qualify_lead','prepare_outreach','send_outreach','followup_outreach'));

CREATE TABLE IF NOT EXISTS distribution_contacts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id = 'tenant-free-review-system'),
  email text NOT NULL,
  company text,
  source_url text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  outreach_basis text,
  consent_evidence_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed','suppressed','invalid')),
  last_contacted_at timestamp,
  next_followup_at timestamp,
  followup_count integer NOT NULL DEFAULT 0 CHECK (followup_count >= 0),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS distribution_contacts_followup_idx ON distribution_contacts (next_followup_at) WHERE status = 'active' AND next_followup_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS distribution_messages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id = 'tenant-free-review-system'),
  contact_id text NOT NULL REFERENCES distribution_contacts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('initial','followup')),
  subject text NOT NULL,
  provider_message_id text,
  status text NOT NULL CHECK (status IN ('queued','sent','failed')),
  body_hash text,
  sent_at timestamp,
  error text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS distribution_messages_contact_idx ON distribution_messages (contact_id, created_at DESC);

ALTER TABLE distribution_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE distribution_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_messages FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='distribution_contacts' AND policyname='spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON distribution_contacts USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='distribution_messages' AND policyname='spr_tenant_isolation') THEN
    CREATE POLICY spr_tenant_isolation ON distribution_messages USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_contacts TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON distribution_messages TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_contacts TO spr_worker_runtime;
    GRANT SELECT, INSERT, UPDATE ON distribution_messages TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
