-- Runtime roles must never bypass PostgreSQL Row-Level Security.
-- This closes the privilege gap on existing installations while remaining
-- safe for fresh databases where the roles may not yet exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    ALTER ROLE spr_app_runtime NOBYPASSRLS;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    ALTER ROLE spr_worker_runtime NOBYPASSRLS;
  END IF;
END
$$;
