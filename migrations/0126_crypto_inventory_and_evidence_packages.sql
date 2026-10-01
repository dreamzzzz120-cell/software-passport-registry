BEGIN;

CREATE TABLE IF NOT EXISTS spr_crypto_inventory (
  inventory_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('algorithm','key','certificate','protocol','signing-location','verification-location')),
  algorithm_id text REFERENCES spr_crypto_algorithms(algorithm_id),
  key_id text,
  certificate_id text,
  protocol_name text,
  signing_location text,
  verification_location text,
  expires_at timestamptz,
  owner_identity text,
  dependency text,
  affected_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (jsonb_typeof(affected_evidence) = 'array'),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS spr_crypto_inventory_lookup_idx
  ON spr_crypto_inventory(tenant_id,algorithm_id,key_id,certificate_id,protocol_name);
CREATE INDEX IF NOT EXISTS spr_crypto_inventory_expiry_idx
  ON spr_crypto_inventory(tenant_id,expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS spr_evidence_packages (
  package_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  schema_version text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  observations jsonb NOT NULL,
  evidence_references jsonb NOT NULL,
  payload_digest_algorithm text NOT NULL REFERENCES spr_crypto_algorithms(algorithm_id),
  payload_digest text NOT NULL,
  signature_algorithm text NOT NULL REFERENCES spr_crypto_algorithms(algorithm_id),
  signing_key_id text NOT NULL,
  signature text NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (jsonb_typeof(observations) = 'array'),
  CHECK (jsonb_typeof(evidence_references) = 'array')
);

CREATE INDEX IF NOT EXISTS spr_evidence_packages_subject_idx
  ON spr_evidence_packages(tenant_id,subject,created_at DESC);
CREATE INDEX IF NOT EXISTS spr_evidence_packages_key_idx
  ON spr_evidence_packages(tenant_id,signing_key_id,created_at DESC);

CREATE TABLE IF NOT EXISTS spr_evidence_package_verifications (
  verification_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  package_id text NOT NULL REFERENCES spr_evidence_packages(package_id),
  verification_state text NOT NULL CHECK (verification_state IN ('UNKNOWN','UNVERIFIED','VERIFIED','CONFLICT','EXPIRED','FAILED')),
  verified_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signing_key_state text CHECK (signing_key_state IN ('ACTIVE','DEPRECATED','REVOKED','COMPROMISED')),
  verifier_identity text NOT NULL,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS spr_evidence_package_verifications_package_idx
  ON spr_evidence_package_verifications(tenant_id,package_id,verified_at DESC);

ALTER TABLE spr_crypto_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_crypto_inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE spr_evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_evidence_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE spr_evidence_package_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_evidence_package_verifications FORCE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spr_crypto_inventory','spr_evidence_packages','spr_evidence_package_verifications']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname='spr_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        t
      );
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS spr_crypto_inventory_append_only ON spr_crypto_inventory;
CREATE TRIGGER spr_crypto_inventory_append_only
BEFORE UPDATE OR DELETE ON spr_crypto_inventory
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

DROP TRIGGER IF EXISTS spr_evidence_packages_append_only ON spr_evidence_packages;
CREATE TRIGGER spr_evidence_packages_append_only
BEFORE UPDATE OR DELETE ON spr_evidence_packages
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

DROP TRIGGER IF EXISTS spr_evidence_package_verifications_append_only ON spr_evidence_package_verifications;
CREATE TRIGGER spr_evidence_package_verifications_append_only
BEFORE UPDATE OR DELETE ON spr_evidence_package_verifications
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT ON spr_crypto_inventory, spr_evidence_packages, spr_evidence_package_verifications TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT ON spr_crypto_inventory, spr_evidence_packages, spr_evidence_package_verifications TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
