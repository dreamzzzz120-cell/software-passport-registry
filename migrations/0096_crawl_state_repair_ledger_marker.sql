BEGIN;

-- Ledger marker only; no schema change.
--
-- Production recorded version 0096 in schema_migrations at 2026-09-14T04:42Z
-- when the registry_crawl_state repair first shipped under this number. It
-- was then renumbered to 0097 and re-ran there as a no-op. A second file also
-- claimed 0096 (public API v1); the runner keys on the version alone, so that
-- file was never executed in production and now lives at 0098.
--
-- This file keeps the sequence contiguous and makes the meaning of the
-- recorded 0096 explicit. Fresh environments run it as a no-op.
SELECT 1;

COMMIT;
