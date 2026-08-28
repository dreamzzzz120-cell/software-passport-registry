BEGIN;

-- Real production bug, found via an adversarial RBAC test: removing a team
-- member (DELETE FROM users ... in routes/auth.ts) fails for any member who
-- has ever logged in -- which, since requireAuth calls recordSession() on
-- every authenticated request, means virtually always. login_history's
-- user_id FK is ON DELETE CASCADE, so removing a user makes Postgres try to
-- delete their login_history rows, but spr_login_history_integrity
-- unconditionally rejects every DELETE/UPDATE with LOGIN_HISTORY_IMMUTABLE
-- (correctly, by design -- login history is meant to survive as an audit
-- trail). The cascade delete hits that rejection and aborts the whole
-- transaction, so "remove team member" has been silently broken (a raw
-- 500) for any real member since this table was introduced.
--
-- Fix: login history should survive the user it belonged to being removed
-- (that's the point of an audit trail), not block the removal. Change the
-- FK to ON DELETE SET NULL and carve out exactly that one transition in the
-- trigger -- every other mutation is still rejected exactly as before.

ALTER TABLE login_history ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE login_history DROP CONSTRAINT login_history_user_id_fkey;
ALTER TABLE login_history ADD CONSTRAINT login_history_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION spr_enforce_login_history_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- The one permitted mutation: ON DELETE SET NULL firing when the
    -- referenced user is removed. Every other column must be byte-for-byte
    -- unchanged, and every other kind of update is still rejected.
    IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id
       AND NEW.occurred_at = OLD.occurred_at AND NEW.ip = OLD.ip
       AND NEW.user_agent = OLD.user_agent AND NEW.status = OLD.status THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Login history entry does not belong to the referenced user''s tenant';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
