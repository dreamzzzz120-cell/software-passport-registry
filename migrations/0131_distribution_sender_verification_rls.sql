BEGIN;

-- distribution_sender_verifications is operational telemetry, not tenant-owned
-- prospect data. It intentionally has no tenant_id column. Some production
-- databases inherited RLS on this table, which blocks the least-privileged
-- worker from recording the one-time sender verification even though the
-- worker has explicit SELECT/INSERT/UPDATE grants.
--
-- Keep tenant RLS fully intact everywhere it belongs; disable it only on this
-- non-tenant table so sender verification can be recorded without BYPASSRLS.
ALTER TABLE distribution_sender_verifications DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON distribution_sender_verifications TO spr_worker_runtime;
  END IF;
END
$$;

COMMIT;
