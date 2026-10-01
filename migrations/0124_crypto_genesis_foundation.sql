BEGIN;

CREATE TABLE IF NOT EXISTS spr_crypto_algorithms (
  algorithm_id text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('hash','signature','key-establishment','certificate')),
  family text NOT NULL CHECK (family IN ('classical','post-quantum','hybrid')),
  implementation_state text NOT NULL CHECK (implementation_state IN ('active','planned','deprecated')),
  standard_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO spr_crypto_algorithms (algorithm_id,purpose,family,implementation_state,standard_name) VALUES
 ('sha2-256','hash','classical','active','SHA-256'),
 ('sha2-512','hash','classical','active','SHA-512'),
 ('ed25519','signature','classical','active','Ed25519'),
 ('ecdsa-p256-sha256','signature','classical','active','ECDSA P-256 with SHA-256'),
 ('ml-kem-768','key-establishment','post-quantum','planned','ML-KEM-768'),
 ('ml-dsa-65','signature','post-quantum','planned','ML-DSA-65'),
 ('slh-dsa-sha2-128s','signature','post-quantum','planned','SLH-DSA-SHA2-128s'),
 ('hybrid-ed25519-ml-dsa-65','signature','hybrid','planned','Hybrid Ed25519 + ML-DSA-65')
ON CONFLICT (algorithm_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS spr_crypto_keys (
  key_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  algorithm_id text NOT NULL REFERENCES spr_crypto_algorithms(algorithm_id),
  owner_identity text NOT NULL,
  public_key text,
  state text NOT NULL CHECK (state IN ('ACTIVE','DEPRECATED','REVOKED','COMPROMISED')),
  not_before timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  compromised_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (state <> 'REVOKED' OR revoked_at IS NOT NULL),
  CHECK (state <> 'COMPROMISED' OR compromised_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS spr_crypto_keys_tenant_state_idx ON spr_crypto_keys(tenant_id,state,updated_at DESC);

CREATE TABLE IF NOT EXISTS spr_crypto_key_state_events (
  event_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  key_id text NOT NULL REFERENCES spr_crypto_keys(key_id),
  previous_state text,
  new_state text NOT NULL CHECK (new_state IN ('ACTIVE','DEPRECATED','REVOKED','COMPROMISED')),
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason text,
  affected_evidence jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS spr_crypto_key_state_events_key_idx ON spr_crypto_key_state_events(tenant_id,key_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS spr_genesis_events (
  genesis_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  creator_identity text NOT NULL,
  creator_type text NOT NULL CHECK (creator_type IN ('human','ai-agent','autonomous-agent','service','system')),
  parent_identity text,
  authority_chain jsonb NOT NULL,
  creation_timestamp timestamptz NOT NULL,
  source_digest text,
  artifact_digest text NOT NULL,
  build_digest text,
  sbom_digest text,
  build_environment jsonb NOT NULL,
  policy_version text NOT NULL,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  signing_key_id text NOT NULL,
  signature_algorithm text NOT NULL REFERENCES spr_crypto_algorithms(algorithm_id),
  signature text NOT NULL,
  parent_genesis_id text REFERENCES spr_genesis_events(genesis_id),
  child_identity text NOT NULL,
  creation_reason text NOT NULL,
  authorization_reference text,
  event_digest_algorithm text NOT NULL REFERENCES spr_crypto_algorithms(algorithm_id),
  event_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (creator_identity <> child_identity),
  CHECK (parent_identity IS NULL OR parent_identity <> child_identity),
  CHECK (jsonb_typeof(authority_chain) = 'array' AND jsonb_array_length(authority_chain) > 0),
  CHECK (jsonb_typeof(evidence_references) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS spr_genesis_events_tenant_child_idx ON spr_genesis_events(tenant_id,child_identity,genesis_id);
CREATE INDEX IF NOT EXISTS spr_genesis_events_artifact_idx ON spr_genesis_events(tenant_id,artifact_digest);

CREATE TABLE IF NOT EXISTS spr_evidence_artifact_bindings (
  binding_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  evidence_id text NOT NULL,
  artifact_digest text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id,evidence_id,artifact_digest)
);

CREATE INDEX IF NOT EXISTS spr_evidence_artifact_bindings_artifact_idx ON spr_evidence_artifact_bindings(tenant_id,artifact_digest);

CREATE OR REPLACE FUNCTION spr_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS spr_genesis_events_append_only ON spr_genesis_events;
CREATE TRIGGER spr_genesis_events_append_only
BEFORE UPDATE OR DELETE ON spr_genesis_events
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

DROP TRIGGER IF EXISTS spr_crypto_key_state_events_append_only ON spr_crypto_key_state_events;
CREATE TRIGGER spr_crypto_key_state_events_append_only
BEFORE UPDATE OR DELETE ON spr_crypto_key_state_events
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

DROP TRIGGER IF EXISTS spr_evidence_artifact_bindings_append_only ON spr_evidence_artifact_bindings;
CREATE TRIGGER spr_evidence_artifact_bindings_append_only
BEFORE UPDATE OR DELETE ON spr_evidence_artifact_bindings
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION spr_crypto_key_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key_id <> OLD.key_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.algorithm_id <> OLD.algorithm_id OR NEW.owner_identity <> OLD.owner_identity OR NEW.public_key IS DISTINCT FROM OLD.public_key OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'crypto key identity and key material are immutable';
    END IF;
    IF OLD.state IN ('REVOKED','COMPROMISED') AND NEW.state <> OLD.state THEN
      RAISE EXCEPTION 'terminal crypto key state cannot transition';
    END IF;
    IF OLD.state = 'DEPRECATED' AND NEW.state = 'ACTIVE' THEN
      RAISE EXCEPTION 'deprecated crypto key cannot return to active';
    END IF;
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_crypto_key_state_transition ON spr_crypto_keys;
CREATE TRIGGER spr_crypto_key_state_transition
BEFORE UPDATE ON spr_crypto_keys
FOR EACH ROW EXECUTE FUNCTION spr_crypto_key_state_transition();

CREATE OR REPLACE FUNCTION spr_record_crypto_key_state_event()
RETURNS trigger
LANGUAGE plpgsql
AS $
DECLARE prior_state text;
BEGIN
  prior_state := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END;
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO spr_crypto_key_state_events (
      event_id, tenant_id, key_id, previous_state, new_state, reason
    ) VALUES (
      NEW.key_id || ':' || txid_current()::text || ':' || floor(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text,
      NEW.tenant_id,
      NEW.key_id,
      prior_state,
      NEW.state,
      CASE WHEN TG_OP = 'INSERT' THEN 'key-created' ELSE 'state-transition' END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_crypto_key_state_event ON spr_crypto_keys;
CREATE TRIGGER spr_crypto_key_state_event
AFTER INSERT OR UPDATE ON spr_crypto_keys
FOR EACH ROW EXECUTE FUNCTION spr_record_crypto_key_state_event();

ALTER TABLE spr_crypto_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_crypto_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE spr_crypto_key_state_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_crypto_key_state_events FORCE ROW LEVEL SECURITY;
ALTER TABLE spr_genesis_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_genesis_events FORCE ROW LEVEL SECURITY;
ALTER TABLE spr_evidence_artifact_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_evidence_artifact_bindings FORCE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spr_crypto_keys','spr_crypto_key_state_events','spr_genesis_events','spr_evidence_artifact_bindings']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='spr_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT ON spr_crypto_algorithms TO spr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON spr_crypto_keys TO spr_app_runtime;
    GRANT SELECT, INSERT ON spr_crypto_key_state_events, spr_genesis_events, spr_evidence_artifact_bindings TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT ON spr_crypto_algorithms TO spr_worker_runtime;
    GRANT SELECT ON spr_crypto_keys TO spr_worker_runtime;
    GRANT SELECT, INSERT ON spr_crypto_key_state_events, spr_genesis_events, spr_evidence_artifact_bindings TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
