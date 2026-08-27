BEGIN;

-- MSP client creation + onboarding. Previously: 0 rows existed in `clients`
-- in production, there was no backend route to create one, and even the
-- 'Client' role already listed in INVITABLE_ROLES (auth.ts) had no actual
-- mechanism to restrict a user to a single client's data -- users only ever
-- had a tenant_id, never a client_id.
--
-- client_id is nullable and only ever set for a 'Client'-role user; every
-- other role (Owner/Admin/Technician/Viewer) keeps it NULL and continues to
-- see the whole tenant, unchanged. ON DELETE SET NULL rather than CASCADE:
-- removing a client should not delete the user account, just their scope.
ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id text REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_client_idx ON users (client_id) WHERE client_id IS NOT NULL;

-- Real duplicate handling for client creation: two clients with the same
-- domain under one tenant is almost certainly a mistake (or a duplicate
-- double-submit), not a legitimate distinct client. Enforced at the
-- database level so a race between two concurrent creates can't both
-- succeed -- the API catches this constraint and returns a clean 409.
ALTER TABLE clients ADD CONSTRAINT clients_tenant_domain_unique UNIQUE (tenant_id, domain);

COMMIT;
