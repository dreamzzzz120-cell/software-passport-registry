BEGIN;

-- Tombstone. Intentionally does nothing.
--
-- 0062 and 0063 both once held copies of the async scan progress/notification
-- migration, and 0062 later held a second copy of the Active Passport
-- entitlement guard. Those duplicates were deleted (292a71b, c917e8f, d3f1300),
-- which left holes at 0062 and 0063 in a sequence the Production Release Gate
-- requires to be contiguous -- so every release run since has failed with
-- "Migration sequence gap/out-of-order: expected 0062, found 0064".
--
-- The numbers are not reused for new work and the files are not renumbered:
-- schema_migrations already records applied versions by number in every
-- environment, so renumbering would either re-run migrations that have run or
-- silently skip ones that have not. A tombstone restores the invariant, keeps
-- the history readable, and is safe to apply anywhere.

COMMIT;
