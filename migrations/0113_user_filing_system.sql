BEGIN;

CREATE TABLE IF NOT EXISTS user_file_folders (
  id text PRIMARY KEY, tenant_id text NOT NULL, parent_folder_id text NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text NULL, created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at timestamptz NULL,
  CONSTRAINT user_file_folders_parent_fk FOREIGN KEY (parent_folder_id) REFERENCES user_file_folders(id) ON DELETE RESTRICT,
  CONSTRAINT user_file_folders_parent_tenant_guard CHECK (parent_folder_id IS NULL OR parent_folder_id <> id)
);

CREATE TABLE IF NOT EXISTS user_files (
  id text PRIMARY KEY, tenant_id text NOT NULL, folder_id text NULL, object_file_id text NULL,
  original_name text NOT NULL CHECK (length(btrim(original_name)) BETWEEN 1 AND 512),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 512),
  content_type text NOT NULL DEFAULT 'application/octet-stream', byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  sha256 text NULL CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  category text NOT NULL DEFAULT 'other',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb, description text NULL, version text NULL,
  owner_user_id integer NULL, expires_at timestamptz NULL,
  security_status text NOT NULL DEFAULT 'pending'
    CHECK (security_status IN ('pending','clean','blocked','quarantined','failed','unknown')),
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','archived','deleted')),
  source text NOT NULL DEFAULT 'user_upload', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at timestamptz NULL,
  CONSTRAINT user_files_folder_fk FOREIGN KEY (folder_id) REFERENCES user_file_folders(id) ON DELETE SET NULL,
  CONSTRAINT user_files_object_fk FOREIGN KEY (object_file_id) REFERENCES object_files(id) ON DELETE SET NULL,
  CONSTRAINT user_files_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_file_links (
  id text PRIMARY KEY, tenant_id text NOT NULL, file_id text NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('client','passport','scan','evidence','finding','vendor','report')),
  target_id text NOT NULL, created_by text NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, file_id, link_type, target_id)
);

CREATE TABLE IF NOT EXISTS user_file_audit (
  id bigserial PRIMARY KEY, tenant_id text NOT NULL, file_id text NULL REFERENCES user_files(id) ON DELETE SET NULL,
  actor_user_id integer NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('create','view','download','rename','move','tag','link','unlink','archive','restore','delete','security_scan','share_attempt')),
  outcome text NOT NULL DEFAULT 'allowed' CHECK (outcome IN ('allowed','denied','failed')),
  request_id text NULL, ip_hash text NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS user_file_folders_tenant_idx ON user_file_folders(tenant_id, parent_folder_id, deleted_at);
CREATE INDEX IF NOT EXISTS user_files_tenant_folder_idx ON user_files(tenant_id, folder_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS user_files_tenant_category_idx ON user_files(tenant_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_sha256_idx ON user_files(tenant_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_file_links_target_idx ON user_file_links(tenant_id, link_type, target_id);
CREATE INDEX IF NOT EXISTS user_file_audit_file_idx ON user_file_audit(tenant_id, file_id, created_at DESC);

ALTER TABLE user_file_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_file_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_files FORCE ROW LEVEL SECURITY;
ALTER TABLE user_file_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_file_links FORCE ROW LEVEL SECURITY;
ALTER TABLE user_file_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_file_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY spr_tenant_isolation ON user_file_folders USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY spr_tenant_isolation ON user_files USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY spr_tenant_isolation ON user_file_links USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY spr_tenant_isolation ON user_file_audit USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY spr_worker_cross_tenant ON user_file_folders FOR ALL TO spr_worker_runtime USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');
CREATE POLICY spr_worker_cross_tenant ON user_files FOR ALL TO spr_worker_runtime USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');
CREATE POLICY spr_worker_cross_tenant ON user_file_links FOR ALL TO spr_worker_runtime USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');
CREATE POLICY spr_worker_cross_tenant ON user_file_audit FOR ALL TO spr_worker_runtime USING (current_user = 'spr_worker_runtime') WITH CHECK (current_user = 'spr_worker_runtime');

GRANT SELECT, INSERT, UPDATE, DELETE ON user_file_folders, user_files, user_file_links, user_file_audit TO spr_app_runtime, spr_worker_runtime;
GRANT USAGE, SELECT ON SEQUENCE user_file_audit_id_seq TO spr_app_runtime, spr_worker_runtime;

CREATE OR REPLACE FUNCTION spr_user_file_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS user_file_folders_touch ON user_file_folders;
CREATE TRIGGER user_file_folders_touch BEFORE UPDATE ON user_file_folders FOR EACH ROW EXECUTE FUNCTION spr_user_file_touch_updated_at();

DROP TRIGGER IF EXISTS user_files_touch ON user_files;
CREATE TRIGGER user_files_touch BEFORE UPDATE ON user_files FOR EACH ROW EXECUTE FUNCTION spr_user_file_touch_updated_at();

CREATE OR REPLACE FUNCTION spr_user_file_link_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file_tenant text;
BEGIN
  SELECT tenant_id INTO file_tenant FROM user_files WHERE id = NEW.file_id;
  IF file_tenant IS NULL OR file_tenant <> NEW.tenant_id THEN RAISE EXCEPTION 'USER_FILE_CROSS_TENANT_LINK'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_file_link_tenant_guard ON user_file_links;
CREATE TRIGGER user_file_link_tenant_guard BEFORE INSERT OR UPDATE ON user_file_links FOR EACH ROW EXECUTE FUNCTION spr_user_file_link_tenant_guard();

CREATE OR REPLACE FUNCTION spr_user_file_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'USER_FILE_AUDIT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_file_audit_immutable ON user_file_audit;
CREATE TRIGGER user_file_audit_immutable BEFORE UPDATE OR DELETE ON user_file_audit FOR EACH ROW EXECUTE FUNCTION spr_user_file_audit_immutable();

COMMIT;
