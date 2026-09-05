BEGIN;

-- Production incident, 2026-09-05. Migration 0068 created psa_webhook_endpoints
-- and psa_webhook_events, both carrying tenant_id, without enabling or forcing
-- row-level security on either. spr_assert_tenant_rls() enumerates every public
-- table with a tenant_id column and raises when one is not hardened, so /ready
-- began returning 503 with tenantRls.ok=false, the Railway healthcheck never
-- passed, and five consecutive deploys failed while the previously-deployed
-- instance kept serving in a degraded state.
--
-- That assertion did exactly its job: the two tables really were unprotected.
-- Until this migration, a query against either that forgot the tenant guard
-- would have read PSA webhook endpoints and ticket events across every tenant,
-- and endpoints are where per-tenant webhook secrets live.
--
-- Written as the same idempotent block 0056 uses, so it hardens whatever is
-- present and stays safe to re-run.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['psa_webhook_endpoints', 'psa_webhook_events'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
    ) THEN
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

      -- Without the grant the policy is never reached: a tenant-scoped read
      -- fails on privileges first, which looks like a bug rather than isolation.
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_app_runtime', tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_worker_runtime', tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Fail here rather than letting /ready discover it after the image is built and
-- the healthcheck is already burning its retry window. If any tenant table is
-- still unhardened, this migration aborts and the deploy stops with a message
-- naming the tables, instead of a 503 that has to be traced back by hand.
SELECT spr_assert_tenant_rls();

COMMIT;
