-- Harden runtime database roles: neither application nor worker runtime roles
-- may bypass PostgreSQL Row-Level Security. Migration 0020 created these roles
-- for least-privileged access; this migration closes the remaining privilege gap
-- on already-provisioned databases and on fresh databases after 0020.
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
