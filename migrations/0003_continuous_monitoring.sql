BEGIN;

CREATE TABLE IF NOT EXISTS monitoring_configurations (
  id text PRIMARY KEY, tenant_id text NOT NULL, client_id text NOT NULL,
  asset_id text NOT NULL, passport_id text NOT NULL, collector_id text NOT NULL,
  subject_type text NOT NULL, subject_identifier text NOT NULL,
  enabled integer NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  schedule_seconds integer NOT NULL CHECK (schedule_seconds >= 900),
  last_attempted_at text, last_successful_at text, next_scheduled_at text NOT NULL,
  credential_reference_id text, failure_count integer NOT NULL DEFAULT 0,
  consecutive_failure_count integer NOT NULL DEFAULT 0,
  last_status text NOT NULL DEFAULT 'unknown',
  freshness_policy_id text NOT NULL, confidence_policy_id text NOT NULL,
  created_by text NOT NULL, updated_by text NOT NULL,
  created_at text NOT NULL, updated_at text NOT NULL,
  UNIQUE (tenant_id, asset_id, collector_id, subject_identifier)
);

CREATE TABLE IF NOT EXISTS collector_jobs (
  id text PRIMARY KEY, tenant_id text NOT NULL, client_id text NOT NULL,
  asset_id text NOT NULL, passport_id text NOT NULL,
  monitoring_configuration_id text, collector_id text NOT NULL,
  collector_version text NOT NULL, subject_type text NOT NULL,
  subject_identifier text NOT NULL, schedule_source text NOT NULL,
  observation_window text NOT NULL, idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','claimed','running','succeeded','failed','timed_out','cancelled','dead_lettered')),
  attempt_number integer NOT NULL DEFAULT 0, maximum_attempts integer NOT NULL DEFAULT 3,
  lease_owner text, lease_expires_at text, heartbeat_at text,
  created_at text NOT NULL, started_at text, completed_at text,
  next_attempt_at text NOT NULL, safe_error_code text, safe_error_message text
);
CREATE UNIQUE INDEX IF NOT EXISTS collector_jobs_active_key
  ON collector_jobs (idempotency_key)
  WHERE state IN ('queued','claimed','running');
CREATE INDEX IF NOT EXISTS collector_jobs_claim
  ON collector_jobs (state, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS monitoring_due
  ON monitoring_configurations (enabled, next_scheduled_at);

CREATE TABLE IF NOT EXISTS collector_results (
  id text PRIMARY KEY, tenant_id text NOT NULL, client_id text NOT NULL,
  asset_id text NOT NULL, passport_id text NOT NULL,
  job_id text NOT NULL UNIQUE REFERENCES collector_jobs(id),
  collector_id text NOT NULL, collector_version text NOT NULL,
  subject_type text NOT NULL, subject_identifier text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed','timed_out','unavailable','unsupported')),
  started_at text NOT NULL, completed_at text NOT NULL,
  evidence_ids text NOT NULL DEFAULT '[]', finding_ids text NOT NULL DEFAULT '[]',
  verification_methods text NOT NULL DEFAULT '[]', limitations text NOT NULL DEFAULT '[]',
  safe_error_code text, safe_error_message text
);

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id text PRIMARY KEY, tenant_id text NOT NULL, client_id text, asset_id text,
  passport_id text, collector_id text, alert_types text NOT NULL,
  minimum_severity text NOT NULL, enabled integer NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  delivery_channel text NOT NULL DEFAULT 'in_app' CHECK (delivery_channel = 'in_app'),
  destination_reference text, created_by text NOT NULL, updated_by text NOT NULL,
  created_at text NOT NULL, updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_subscriptions_match
  ON alert_subscriptions (tenant_id, enabled, minimum_severity);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id text PRIMARY KEY, tenant_id text NOT NULL,
  subscription_id text NOT NULL REFERENCES alert_subscriptions(id),
  alert_id text NOT NULL, deduplication_key text NOT NULL,
  created_at text NOT NULL, read_at text,
  UNIQUE (tenant_id, subscription_id, deduplication_key)
);

CREATE TABLE IF NOT EXISTS credential_references (
  id text PRIMARY KEY, tenant_id text NOT NULL, provider text NOT NULL,
  encrypted_payload text NOT NULL, encryption_key_version text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  last_used_at text, revoked_at text, created_by text NOT NULL,
  created_at text NOT NULL, updated_at text NOT NULL
);

COMMIT;

-- Rollback (destructive; only before production data exists):
-- DROP TABLE in_app_notifications, alert_subscriptions, collector_results,
--   collector_jobs, monitoring_configurations, credential_references;
