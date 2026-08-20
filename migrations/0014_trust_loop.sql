BEGIN;
CREATE TABLE IF NOT EXISTS evidence_ledger (
 id text PRIMARY KEY, tenant_id text NOT NULL, passport_id text NOT NULL, client_id text NOT NULL, asset_id text NOT NULL,
 provider text NOT NULL, control_id text NOT NULL, subject text NOT NULL, source_url text NOT NULL, observed_at text NOT NULL,
 verification_method text NOT NULL, status text NOT NULL CHECK(status IN ('PASS','FAIL','UNKNOWN')), severity text NOT NULL,
 value text NOT NULL, evidence_hash text NOT NULL, limitation text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_ledger_tenant_passport ON evidence_ledger(tenant_id,passport_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS evidence_ledger_tenant_control ON evidence_ledger(tenant_id,control_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS trust_findings (
 id text PRIMARY KEY, tenant_id text NOT NULL, passport_id text NOT NULL, client_id text NOT NULL, asset_id text NOT NULL,
 control_id text NOT NULL, title text NOT NULL, severity text NOT NULL CHECK(severity IN ('informational','low','medium','high','critical')),
 status text NOT NULL CHECK(status IN ('OPEN','UNKNOWN','RESOLVED')), description text NOT NULL, remediation text NOT NULL,
 evidence_ids text NOT NULL DEFAULT '[]', fingerprint text NOT NULL, policy_version text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
 resolved_at timestamp, UNIQUE(tenant_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS trust_findings_tenant_passport ON trust_findings(tenant_id,passport_id,status,severity);
CREATE TABLE IF NOT EXISTS remediation_verification_ledger (
 id text PRIMARY KEY, tenant_id text NOT NULL, finding_id text NOT NULL, status text NOT NULL CHECK(status IN ('VERIFIED','UNVERIFIED')),
 prior_evidence_ids text NOT NULL DEFAULT '[]', verification_evidence_ids text NOT NULL DEFAULT '[]', observation_ids text NOT NULL DEFAULT '[]',
 actor_id text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS remediation_verification_finding ON remediation_verification_ledger(tenant_id,finding_id,created_at DESC);
COMMIT;
