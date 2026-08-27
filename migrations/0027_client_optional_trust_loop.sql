BEGIN;

-- Real production bug, found via live testing: passports.client_id is
-- legitimately nullable (a passport not owned by any MSP client is a real,
-- intentional state -- e.g. the seeded self-hosted "Software Passport
-- Registry" passport itself), but src/routes/trust-loop.ts's /collect route
-- fabricated a client_id for these passports with
--   clientId: passport.client_id || passport.id
-- substituting the passport's OWN id as its client. evidence_ledger and
-- trust_findings accepted this silently (client_id is NOT NULL there but has
-- no foreign key), but trust_observations DOES have a real foreign key to
-- clients(id), so the fabricated, nonexistent client id violated it and the
-- whole collection failed with a foreign-key error on every provider for
-- any client-less passport.
--
-- The fix (in the same commit as this migration) stops fabricating a client
-- id and passes the real value, including null. This migration makes that
-- representable: client_id becomes nullable on all three tables, matching
-- passports.client_id's existing nullable design. A NULL client_id already
-- satisfies both trust_observations foreign keys (a NULL foreign key value
-- is never a constraint violation), so no data change is needed there --
-- only the NOT NULL constraints are relaxed.

ALTER TABLE evidence_ledger ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE trust_findings ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE trust_observations ALTER COLUMN client_id DROP NOT NULL;

COMMIT;
