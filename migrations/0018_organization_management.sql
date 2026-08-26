BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;

CREATE TABLE IF NOT EXISTS user_sessions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_fingerprint text NOT NULL,
  ip text NOT NULL DEFAULT 'unknown',
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, user_id, session_fingerprint)
);
CREATE INDEX IF NOT EXISTS user_sessions_tenant_user_idx ON user_sessions (tenant_id, user_id, last_seen_at DESC);

CREATE OR REPLACE FUNCTION spr_enforce_user_session_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'User session does not belong to the referenced user''s tenant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_user_session_integrity ON user_sessions;
CREATE TRIGGER spr_user_session_integrity BEFORE INSERT OR UPDATE ON user_sessions
FOR EACH ROW EXECUTE FUNCTION spr_enforce_user_session_integrity();

CREATE TABLE IF NOT EXISTS login_history (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip text NOT NULL DEFAULT 'unknown',
  user_agent text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Verified'
);
CREATE INDEX IF NOT EXISTS login_history_tenant_user_idx ON login_history (tenant_id, user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION spr_enforce_login_history_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Login history entry does not belong to the referenced user''s tenant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spr_login_history_integrity ON login_history;
CREATE TRIGGER spr_login_history_integrity BEFORE INSERT OR UPDATE OR DELETE ON login_history
FOR EACH ROW EXECUTE FUNCTION spr_enforce_login_history_integrity();

-- src/routes/connect.ts (POST/GET /v1/software) has referenced this table since
-- the Connect API was introduced, but no migration ever created it -- every call
-- to that endpoint fails with "relation software_registry does not exist".
CREATE TABLE IF NOT EXISTS software_registry (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  version text NOT NULL DEFAULT 'unknown',
  publisher text NOT NULL DEFAULT 'unknown',
  category text NOT NULL DEFAULT 'software',
  source_type text NOT NULL DEFAULT 'application',
  source_url text,
  external_id text,
  license_type text NOT NULL DEFAULT 'unobserved',
  release_date text NOT NULL DEFAULT 'unobserved',
  metadata text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS software_registry_tenant_idx ON software_registry (tenant_id, created_at DESC);

COMMIT;
