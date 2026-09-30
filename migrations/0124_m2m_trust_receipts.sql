BEGIN;

CREATE TABLE IF NOT EXISTS m2m_trust_receipts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  envelope_digest text NOT NULL,
  actor_machine_id text NOT NULL,
  subject_machine_id text NOT NULL,
  requested_action text NOT NULL,
  authority_decision text NOT NULL,
  trust_decision text NOT NULL,
  execution_outcome text NOT NULL,
  evidence_digest text,
  observed_at timestamptz NOT NULL,
  receipt_digest text NOT NULL,
  server_record_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT m2m_receipt_envelope_digest_hex CHECK (envelope_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT m2m_receipt_receipt_digest_hex CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT m2m_receipt_server_digest_hex CHECK (server_record_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT m2m_receipt_evidence_digest_hex CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT m2m_receipt_authority_state CHECK (authority_decision IN ('AUTHORIZED','NOT_AUTHORIZED','UNKNOWN')),
  CONSTRAINT m2m_receipt_trust_state CHECK (trust_decision IN ('VERIFIED','PARTIAL','UNKNOWN','DENIED','REVOKED','EXPIRED')),
  CONSTRAINT m2m_receipt_execution_state CHECK (execution_outcome IN ('OBSERVED_SUCCEEDED','OBSERVED_FAILED','DENIED_NOT_EXECUTED','UNKNOWN')),
  CONSTRAINT m2m_receipt_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id) ON DELETE RESTRICT,
  CONSTRAINT m2m_receipt_tenant_envelope_unique UNIQUE (tenant_id,envelope_digest)
);

CREATE INDEX IF NOT EXISTS m2m_trust_receipts_passport_time_idx ON m2m_trust_receipts(tenant_id,passport_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS m2m_trust_receipts_actor_time_idx ON m2m_trust_receipts(tenant_id,actor_machine_id,observed_at DESC);

ALTER TABLE m2m_trust_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE m2m_trust_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY spr_tenant_isolation ON m2m_trust_receipts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    CREATE POLICY spr_worker_cross_tenant ON m2m_trust_receipts
      FOR ALL TO spr_worker_runtime
      USING (current_user = 'spr_worker_runtime')
      WITH CHECK (current_user = 'spr_worker_runtime');
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

SELECT spr_assert_tenant_rls();

COMMIT;
