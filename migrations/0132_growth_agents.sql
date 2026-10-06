BEGIN;

CREATE TABLE IF NOT EXISTS growth_agents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system'
    CHECK (tenant_id = 'tenant-free-review-system'),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (status IN ('ACTIVE','CONFIG_REQUIRED','DISABLED','UNKNOWN')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  notes text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE growth_agents
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-free-review-system',
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'Growth agent',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

INSERT INTO growth_agents (id, tenant_id, display_name, status, priority, notes)
VALUES
  ('closer','tenant-free-review-system','Closer','ACTIVE',10,'Works observed replied/demo/pilot pipeline states.'),
  ('lead-finder','tenant-free-review-system','Lead Finder','CONFIG_REQUIRED',20,'Requires a configured discovery provider for autonomous discovery.'),
  ('social-scout','tenant-free-review-system','Social Scout','CONFIG_REQUIRED',30,'Requires an approved external social/community discovery provider.'),
  ('followup-crm','tenant-free-review-system','Follow-up / CRM','ACTIVE',40,'Uses existing distribution safety gates; does not duplicate sending.'),
  ('content-seo','tenant-free-review-system','Content / SEO','ACTIVE',50,'Creates evidence-backed founder tasks only.'),
  ('partnership-directory','tenant-free-review-system','Partnership / Directory','ACTIVE',60,'Creates observed outreach/directory tasks.'),
  ('retention-expansion','tenant-free-review-system','Retention / Expansion','ACTIVE',70,'Uses observed subscription and usage state.')
ON CONFLICT (id) DO UPDATE SET
  tenant_id=EXCLUDED.tenant_id,
  display_name=EXCLUDED.display_name,
  priority=EXCLUDED.priority,
  updated_at=CURRENT_TIMESTAMP;

ALTER TABLE growth_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_agents FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='growth_agents' AND policyname='spr_tenant_isolation'
  ) THEN
    CREATE POLICY spr_tenant_isolation ON growth_agents
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='growth_agents' AND policyname='spr_worker_cross_tenant'
  ) THEN
    CREATE POLICY spr_worker_cross_tenant ON growth_agents
      FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON growth_agents TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON growth_agents TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
