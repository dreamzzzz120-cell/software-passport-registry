BEGIN;

CREATE TABLE IF NOT EXISTS spr_m2m_nonce_receipts (
  tenant_id text NOT NULL,
  issuer text NOT NULL,
  nonce text NOT NULL,
  envelope_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, issuer, nonce),
  UNIQUE (tenant_id, envelope_id)
);

CREATE INDEX IF NOT EXISTS spr_m2m_nonce_receipts_expiry_idx
  ON spr_m2m_nonce_receipts(expires_at);

ALTER TABLE spr_m2m_nonce_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE spr_m2m_nonce_receipts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='spr_m2m_nonce_receipts'
      AND policyname='spr_tenant_isolation'
  ) THEN
    CREATE POLICY spr_tenant_isolation ON spr_m2m_nonce_receipts
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DROP TRIGGER IF EXISTS spr_m2m_nonce_receipts_append_only ON spr_m2m_nonce_receipts;
CREATE TRIGGER spr_m2m_nonce_receipts_append_only
BEFORE UPDATE OR DELETE ON spr_m2m_nonce_receipts
FOR EACH ROW EXECUTE FUNCTION spr_reject_append_only_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT ON spr_m2m_nonce_receipts TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT ON spr_m2m_nonce_receipts TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
