BEGIN;

-- Operational layer for the complete Trust loop:
-- collect -> understand -> correlate -> score -> remediate -> re-check -> prove.
CREATE TABLE IF NOT EXISTS trust_collection_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  provider text NOT NULL,
  started_at text NOT NULL,
  completed_at text,
  status text NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED')),
  observation_count integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  collector_version text,
  idempotency_key text NOT NULL,
  created_at text NOT NULL,
  UNIQUE(tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS trust_collection_runs_scope ON trust_collection_runs(tenant_id,passport_id,started_at DESC);

CREATE TABLE IF NOT EXISTS trust_correlation_edges (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  correlation_id text NOT NULL,
  finding_id text NOT NULL,
  contributing_finding_ids text NOT NULL DEFAULT '[]',
  evidence_ids text NOT NULL DEFAULT '[]',
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  created_at text NOT NULL,
  UNIQUE(tenant_id,correlation_id)
);
CREATE INDEX IF NOT EXISTS trust_correlation_scope ON trust_correlation_edges(tenant_id,passport_id,created_at DESC);

CREATE TABLE IF NOT EXISTS trust_remediation_work_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  finding_id text NOT NULL,
  external_system text NOT NULL,
  external_ticket_id text,
  owner_id text,
  owner_display text,
  sla_due_at text,
  status text NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','BLOCKED','READY_FOR_VERIFICATION','VERIFIED','CLOSED','CANCELLED')),
  remediation_plan text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  closed_at text
);
CREATE INDEX IF NOT EXISTS trust_remediation_scope ON trust_remediation_work_items(tenant_id,passport_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS trust_remediation_finding ON trust_remediation_work_items(tenant_id,finding_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS trust_monitoring_state (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  interval_seconds integer NOT NULL DEFAULT 3600,
  next_run_at text,
  last_run_at text,
  last_success_at text,
  last_failure_at text,
  last_evidence_hash text,
  stale_after_seconds integer NOT NULL DEFAULT 86400,
  consecutive_failures integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK(status IN ('HEALTHY','STALE','DEGRADED','FAILED','DISABLED')),
  updated_at text NOT NULL,
  UNIQUE(tenant_id,passport_id,provider)
);
CREATE INDEX IF NOT EXISTS trust_monitoring_due ON trust_monitoring_state(enabled,next_run_at);

CREATE TABLE IF NOT EXISTS trust_alerts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  provider text,
  finding_id text,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('informational','low','medium','high','critical')),
  status text NOT NULL CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED','SUPPRESSED')),
  fingerprint text NOT NULL,
  message text NOT NULL,
  evidence_ids text NOT NULL DEFAULT '[]',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE(tenant_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS trust_alerts_scope ON trust_alerts(tenant_id,passport_id,status,severity,created_at DESC);

CREATE TABLE IF NOT EXISTS trust_report_snapshots (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  report_type text NOT NULL,
  generated_at text NOT NULL,
  score integer NOT NULL,
  confidence_basis_points integer NOT NULL,
  completeness_basis_points integer NOT NULL,
  evidence_ids text NOT NULL DEFAULT '[]',
  finding_ids text NOT NULL DEFAULT '[]',
  observation_id text,
  canonical_payload_hash text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL,
  UNIQUE(tenant_id,passport_id,report_type,canonical_payload_hash)
);
CREATE INDEX IF NOT EXISTS trust_report_scope ON trust_report_snapshots(tenant_id,passport_id,generated_at DESC);

-- Prevent accidental duplicate evidence for the same authoritative source snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS evidence_ledger_snapshot_unique
  ON evidence_ledger(tenant_id,passport_id,provider,control_id,subject,source_url,observed_at,evidence_hash);

COMMIT;
