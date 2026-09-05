BEGIN;

-- Migration 0065 put spr_current_user_role() inside the RLS policy on
-- public.users, revoked EXECUTE from PUBLIC, and granted it back to
-- spr_app_runtime only. The background workers connect as spr_worker_runtime,
-- so every worker query that touches users -- directly or through a policy that
-- has to evaluate the predicate -- fails with
--
--   permission denied for function spr_current_user_role
--
-- Production has 4 dead scan jobs from exactly that error in the last seven
-- days. The job is retried three times, fails identically each time, and is then
-- dead-lettered, so the work is simply lost.
--
-- Granting EXECUTE does not widen what the worker can see. The function reads
-- app.user_id from the session and returns that user's role; with no user_id set
-- -- which is the case for a worker -- it yields no role, so the policy's
-- Owner/Admin/Operator branch stays false and tenant isolation is unchanged. The
-- worker still sees only what its own tenant scope allows. The grant lets the
-- predicate be EVALUATED rather than erroring out.

GRANT EXECUTE ON FUNCTION spr_current_user_role() TO spr_worker_runtime;

COMMIT;
