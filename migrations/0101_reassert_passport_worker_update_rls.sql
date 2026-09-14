BEGIN;

-- Production repair: repository/security scans can persist evidence and findings
-- as spr_worker_runtime, but canonical passport score persistence has been
-- observed failing on UPDATE passports. Reassert the exact least-privilege
-- contract on the table that the scorer writes. This is intentionally
-- idempotent and does not grant BYPASSRLS or use the owner role.
GRANT USAGE ON SCHEMA public TO spr_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passports TO spr_worker_runtime;

ALTER TABLE public.passports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passports FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'passports'
      AND policyname = 'spr_worker_cross_tenant'
  ) THEN
    CREATE POLICY spr_worker_cross_tenant
      ON public.passports
      FOR ALL
      TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
END
$$;

COMMIT;
