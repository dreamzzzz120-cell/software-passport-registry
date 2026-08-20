BEGIN;
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS confidence_basis_points integer NOT NULL DEFAULT 0;
COMMIT;
