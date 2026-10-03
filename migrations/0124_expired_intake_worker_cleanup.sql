BEGIN;

-- The retention worker must be able to see expired anonymous intake rows
-- (tenant_id IS NULL) so abandoned signed-upload objects do not live forever.
-- App runtime remains unable to see them through RLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='intake_sessions' AND policyname='spr_worker_expired_unclaimed_intake') THEN
      CREATE POLICY spr_worker_expired_unclaimed_intake ON intake_sessions
        FOR ALL TO spr_worker_runtime
        USING (current_user='spr_worker_runtime' AND tenant_id IS NULL AND status='OPEN' AND expires_at < CURRENT_TIMESTAMP)
        WITH CHECK (current_user='spr_worker_runtime' AND tenant_id IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='intake_items' AND policyname='spr_worker_unclaimed_intake_items') THEN
      CREATE POLICY spr_worker_unclaimed_intake_items ON intake_items
        FOR ALL TO spr_worker_runtime
        USING (current_user='spr_worker_runtime' AND tenant_id IS NULL)
        WITH CHECK (current_user='spr_worker_runtime' AND tenant_id IS NULL);
    END IF;
  END IF;
END $$;

COMMIT;
