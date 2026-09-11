BEGIN;

-- Add-on subscriptions were only audit-logged: buying "SPR API" or
-- "Continuous Verification" changed nothing a tenant could use, because the
-- 'api' and 'monitoring' capabilities came from the plan alone. Observed on
-- 2026-09-11 while testing every priced item. One row per add-on
-- subscription; the webhook keeps status current; entitlements grant the
-- add-on's capability while the row is active/trialing/past_due.
CREATE TABLE IF NOT EXISTS tenant_addons (
  stripe_subscription_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  addon text NOT NULL CHECK (addon IN ('continuousVerification', 'trustBadge', 'publicPassport', 'api')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  current_period_end timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS tenant_addons_tenant_addon_idx ON tenant_addons (tenant_id, addon, status);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tenant_addons'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'spr_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_addons TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_addons TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
