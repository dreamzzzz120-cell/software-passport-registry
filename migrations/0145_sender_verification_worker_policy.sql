BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Delivery verification is operational telemetry, not prospect data. Unlike
-- contacts, this table has no tenant_id, so its worker needs an explicit role-
-- scoped RLS policy. Never disable RLS or grant anon/authenticated access.
GRANT SELECT, INSERT, UPDATE ON public.distribution_sender_verifications TO spr_worker_runtime;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'distribution_sender_verifications'
      AND policyname = 'spr_sender_verification_worker'
  ) THEN
    CREATE POLICY spr_sender_verification_worker
      ON public.distribution_sender_verifications
      FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END
$$;
COMMIT;
