-- SPDX-License-Identifier: Apache-2.0
-- SPR Base Application Schema
-- This is the authoritative schema defining all 39 tables for the SPR system.
-- This migration is IDEMPOTENT and can be re-run safely.
-- It uses CREATE TABLE IF NOT EXISTS for all tables and CREATE INDEX IF NOT EXISTS for all indexes.
-- No data is modified, deleted, or truncated by this migration.

BEGIN;

-- ============================================================================
-- 1. CORE AUTHENTICATION & AUTHORIZATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  uid text NOT NULL UNIQUE,
  email text NOT NULL,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  role text NOT NULL DEFAULT 'Viewer',
  company_name text,
  role_title text,
  num_technicians integer,
  client_count integer,
  primary_use_case text,
  onboarded integer DEFAULT 0,
  mfa_enabled integer DEFAULT 0,
  mfa_secret text,
  invited_by text,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. CLIENTS & PASSPORTS (Software Asset Management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  name text NOT NULL,
  domain text NOT NULL,
  industry text NOT NULL,
  trust_score integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'Unknown',
  avatar_color text NOT NULL DEFAULT 'indigo',
  subscription_tier text NOT NULL DEFAULT 'Standard',
  joined_date text NOT NULL,
  team_count integer NOT NULL DEFAULT 1,
  passport_count integer NOT NULL DEFAULT 0,
  critical_risks_count integer NOT NULL DEFAULT 0,
  compliance_progress integer NOT NULL DEFAULT 0,
  software_inventory text NOT NULL DEFAULT '[]',
  compliance_status text NOT NULL DEFAULT '[]',
  team_members text NOT NULL DEFAULT '[]',
  activity_timeline text NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS passports (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  client_id text,
  name text NOT NULL,
  version text NOT NULL,
  publisher text NOT NULL,
  category text NOT NULL,
  overall_score integer NOT NULL DEFAULT 0,
  security_score integer NOT NULL DEFAULT 0,
  compliance_score integer NOT NULL DEFAULT 0,
  vendor_reputation_score integer NOT NULL DEFAULT 0,
  release_date text NOT NULL,
  file_hash text NOT NULL,
  license_type text NOT NULL,
  ai_summary text NOT NULL DEFAULT '',
  sbom text NOT NULL DEFAULT '[]',
  evidence text NOT NULL DEFAULT '[]',
  vulnerabilities text NOT NULL DEFAULT '[]',
  timeline text NOT NULL DEFAULT '[]'
);

-- ============================================================================
-- 3. SCANS & ALERTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS scans (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  target_name text NOT NULL,
  scan_type text NOT NULL,
  triggered_by text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  duration_ms integer NOT NULL DEFAULT 0,
  findings_count integer,
  timestamp text NOT NULL,
  client_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  title text NOT NULL,
  severity text NOT NULL,
  category text NOT NULL,
  client_name text NOT NULL,
  description text NOT NULL,
  timestamp text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  passport_id text,
  observation_id text,
  change_type text,
  deduplication_key text,
  first_observed_at text,
  last_observed_at text,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  previous_status text,
  acknowledged_at text,
  resolved_at text,
  client_id text,
  asset_id text,
  source_change_event_id text,
  first_observation_id text,
  acknowledged_by text,
  resolved_by text,
  evidence_ids text,
  finding_ids text,
  updated_at text
);

-- Unique constraint for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS alerts_tenant_dedup_unique
  ON alerts (tenant_id, deduplication_key) WHERE deduplication_key IS NOT NULL;

-- Performance indexes for alerts
CREATE INDEX IF NOT EXISTS alerts_tenant_state ON alerts (tenant_id, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS alerts_tenant_severity ON alerts (tenant_id, severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS alerts_tenant_client ON alerts (tenant_id, client_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS alerts_tenant_asset ON alerts (tenant_id, asset_id, timestamp DESC);

-- ============================================================================
-- 4. TRUST OBSERVATIONS & HISTORICAL TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS trust_observations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  client_id text NOT NULL,
  asset_id text NOT NULL,
  schema_version text NOT NULL,
  observation_version integer NOT NULL CHECK (observation_version > 0),
  generated_at text NOT NULL,
  previous_observation_id text,
  evidence_ids text NOT NULL,
  finding_ids text NOT NULL,
  scoring_policy_version text NOT NULL,
  confidence_policy_version text NOT NULL,
  completeness_basis_points integer NOT NULL CHECK (completeness_basis_points BETWEEN 0 AND 10000),
  known_dimension_count integer NOT NULL CHECK (known_dimension_count >= 0),
  unknown_dimension_count integer NOT NULL CHECK (unknown_dimension_count >= 0),
  stale_dimension_count integer NOT NULL CHECK (stale_dimension_count >= 0),
  expired_dimension_count integer NOT NULL CHECK (expired_dimension_count >= 0),
  canonical_payload_hash text NOT NULL,
  immutable_payload text NOT NULL,
  generation_reason text NOT NULL DEFAULT 'manual'
    CHECK (generation_reason IN ('manual','scheduled_refresh','evidence_change','finding_change','collector_recovery','system')),
  generated_by_actor_id text,
  generated_by_actor_type text NOT NULL DEFAULT 'user'
    CHECK (generated_by_actor_type IN ('user','worker','system')),
  collector_version_map text NOT NULL DEFAULT '{}',
  partially_known_dimension_count integer NOT NULL DEFAULT 0 CHECK (partially_known_dimension_count >= 0),
  unavailable_dimension_count integer NOT NULL DEFAULT 0 CHECK (unavailable_dimension_count >= 0),
  open_finding_count integer NOT NULL DEFAULT 0 CHECK (open_finding_count >= 0),
  persisted_finding_count integer NOT NULL DEFAULT 0 CHECK (persisted_finding_count >= 0),
  idempotency_key text,
  created_at text NOT NULL DEFAULT '',
  UNIQUE (tenant_id, passport_id, observation_version)
);

-- Immutability trigger: prevents updates/deletes to trust observations
CREATE OR REPLACE FUNCTION prevent_trust_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trust_observations_immutable_update ON trust_observations;
CREATE TRIGGER trust_observations_immutable_update
BEFORE UPDATE OR DELETE ON trust_observations
FOR EACH ROW EXECUTE FUNCTION prevent_trust_observation_mutation();

-- Performance indexes for trust observations
CREATE INDEX IF NOT EXISTS trust_observations_tenant_passport_generated
  ON trust_observations (tenant_id, passport_id, observation_version DESC);
CREATE INDEX IF NOT EXISTS trust_observations_tenant_idempotency_unique
  ON trust_observations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS trust_observations_tenant_generated
  ON trust_observations (tenant_id, generated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_observation_changes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  passport_id text NOT NULL,
  observation_id text NOT NULL,
  previous_observation_id text,
  change_type text NOT NULL,
  subject text NOT NULL,
  deduplication_key text NOT NULL,
  details text NOT NULL,
  created_at text NOT NULL,
  dimension text,
  severity text NOT NULL DEFAULT 'informational'
    CHECK (severity IN ('informational','low','medium','high','critical')),
  previous_value text NOT NULL DEFAULT 'null',
  current_value text NOT NULL DEFAULT 'null',
  evidence_ids text NOT NULL DEFAULT '[]',
  finding_ids text NOT NULL DEFAULT '[]',
  materiality_policy_version text NOT NULL DEFAULT 'spr.materiality.v1',
  UNIQUE (tenant_id, observation_id, deduplication_key)
);

CREATE INDEX IF NOT EXISTS trust_changes_tenant_passport
  ON trust_observation_changes (tenant_id, passport_id, created_at DESC);

-- ============================================================================
-- 5. CONTINUOUS MONITORING & COLLECTORS
-- ============================================================================

CREATE TABLE IF NOT EXISTS monitoring_configurations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  asset_id text NOT NULL,
  passport_id text NOT NULL,
  collector_id text NOT NULL,
  subject_type text NOT NULL,
  subject_identifier text NOT NULL,
  enabled integer NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  schedule_seconds integer NOT NULL CHECK (schedule_seconds >= 900),
  last_attempted_at text,
  last_successful_at text,
  next_scheduled_at text NOT NULL,
  credential_reference_id text,
  failure_count integer NOT NULL DEFAULT 0,
  consecutive_failure_count integer NOT NULL DEFAULT 0,
  last_status text NOT NULL DEFAULT 'unknown',
  freshness_policy_id text NOT NULL,
  confidence_policy_id text NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (tenant_id, asset_id, collector_id, subject_identifier)
);

CREATE INDEX IF NOT EXISTS monitoring_due
  ON monitoring_configurations (enabled, next_scheduled_at);

CREATE TABLE IF NOT EXISTS collector_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  asset_id text NOT NULL,
  passport_id text NOT NULL,
  monitoring_configuration_id text,
  collector_id text NOT NULL,
  collector_version text NOT NULL,
  subject_type text NOT NULL,
  subject_identifier text NOT NULL,
  schedule_source text NOT NULL,
  observation_window text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','claimed','running','succeeded','failed','timed_out','cancelled','dead_lettered')),
  attempt_number integer NOT NULL DEFAULT 0,
  maximum_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at text,
  heartbeat_at text,
  created_at text NOT NULL,
  started_at text,
  completed_at text,
  next_attempt_at text NOT NULL,
  safe_error_code text,
  safe_error_message text
);

CREATE UNIQUE INDEX IF NOT EXISTS collector_jobs_active_key
  ON collector_jobs (idempotency_key)
  WHERE state IN ('queued','claimed','running');
CREATE INDEX IF NOT EXISTS collector_jobs_claim
  ON collector_jobs (state, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS collector_results (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  asset_id text NOT NULL,
  passport_id text NOT NULL,
  job_id text NOT NULL UNIQUE REFERENCES collector_jobs(id),
  collector_id text NOT NULL,
  collector_version text NOT NULL,
  subject_type text NOT NULL,
  subject_identifier text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed','timed_out','unavailable','unsupported')),
  started_at text NOT NULL,
  completed_at text NOT NULL,
  evidence_ids text NOT NULL DEFAULT '[]',
  finding_ids text NOT NULL DEFAULT '[]',
  verification_methods text NOT NULL DEFAULT '[]',
  limitations text NOT NULL DEFAULT '[]',
  safe_error_code text,
  safe_error_message text
);

-- ============================================================================
-- 6. ALERTS & NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  client_id text,
  asset_id text,
  passport_id text,
  collector_id text,
  alert_types text NOT NULL,
  minimum_severity text NOT NULL,
  enabled integer NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  delivery_channel text NOT NULL DEFAULT 'in_app' CHECK (delivery_channel = 'in_app'),
  destination_reference text,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS alert_subscriptions_match
  ON alert_subscriptions (tenant_id, enabled, minimum_severity);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subscription_id text NOT NULL REFERENCES alert_subscriptions(id),
  alert_id text NOT NULL,
  deduplication_key text NOT NULL,
  created_at text NOT NULL,
  read_at text,
  UNIQUE (tenant_id, subscription_id, deduplication_key)
);

-- ============================================================================
-- 7. CREDENTIALS & SECRETS MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_references (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  encrypted_payload text NOT NULL,
  encryption_key_version text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  last_used_at text,
  revoked_at text,
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- ============================================================================
-- 8. INTEGRATIONS & BILLING
-- ============================================================================

CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  name text NOT NULL,
  category text NOT NULL,
  icon text NOT NULL,
  connected integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  api_key_hint text NOT NULL DEFAULT '',
  last_sync_date text NOT NULL
);

CREATE TABLE IF NOT EXISTS billing (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  client_name text NOT NULL,
  active_passports_count integer NOT NULL DEFAULT 0,
  price_per_passport integer NOT NULL DEFAULT 45,
  extra_fees integer NOT NULL DEFAULT 0,
  billing_cycle text NOT NULL DEFAULT 'Monthly',
  total_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending',
  stripe_session_id text
);

-- ============================================================================
-- 9. COMPLIANCE & SCHEDULING
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_schedules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  client_id text NOT NULL,
  frequency text NOT NULL,
  target_email text NOT NULL,
  last_audit_at text,
  next_audit_at text,
  status text NOT NULL DEFAULT 'Active',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_schedules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  asset_id text NOT NULL,
  asset_host_name text NOT NULL,
  asset_type text NOT NULL,
  client_name text NOT NULL,
  frequency text NOT NULL,
  scan_type text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  last_run_at text,
  next_run_at text NOT NULL,
  created_at text NOT NULL
);

-- ============================================================================
-- 10. EVIDENCE & FINDINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS evidence_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  asset_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  verified integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'UNKNOWN',
  signer text NOT NULL,
  timestamp text NOT NULL,
  hash text NOT NULL,
  raw_content text NOT NULL DEFAULT '',
  engine_id text NOT NULL,
  verification_failure_reason text
);

CREATE TABLE IF NOT EXISTS scan_findings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  asset_id text NOT NULL,
  job_id text NOT NULL,
  severity text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  component text,
  fixed_version text,
  status text NOT NULL DEFAULT 'Open',
  detected_at text NOT NULL,
  engine_id text NOT NULL
);

-- ============================================================================
-- 11. REPOSITORY SCANNING
-- ============================================================================

CREATE TABLE IF NOT EXISTS repository_connections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  installation_id text NOT NULL,
  label text NOT NULL,
  access_mode text NOT NULL DEFAULT 'public',
  status text NOT NULL DEFAULT 'Active',
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS repository_scan_sources (
  id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  provider text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  requested_ref text,
  resolved_commit_sha text,
  repository_subdirectory text NOT NULL DEFAULT '',
  scanner_configuration text NOT NULL DEFAULT 'syft:1.49.0:cyclonedx-json+osv:v1',
  default_branch text,
  visibility text,
  acquired_at timestamp,
  source_descriptor_hash text,
  manifest_paths text NOT NULL DEFAULT '[]',
  manifest_inventory_hash text,
  raw_sbom_hash text,
  sbom_document text,
  normalized_components text NOT NULL DEFAULT '[]',
  normalized_components_hash text,
  final_findings_hash text,
  scanner_name text,
  scanner_version text,
  scanner_mode text,
  scanner_started_at timestamp,
  scanner_ended_at timestamp,
  scanner_exit_code integer,
  scanner_error_category text,
  temporary_directory_removed integer NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 12. AUDIT & COMPLIANCE LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_trail (
  id serial PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  action text NOT NULL,
  timestamp text NOT NULL,
  actor text NOT NULL,
  payload text NOT NULL,
  previous_hash text NOT NULL,
  current_hash text NOT NULL
);

-- ============================================================================
-- 13. PILOT PROGRAM MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS pilot_organizations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  name text NOT NULL,
  industry text NOT NULL,
  website text,
  size text,
  status text NOT NULL DEFAULT 'Prospect',
  engagement_score integer NOT NULL DEFAULT 50,
  conversion_probability integer NOT NULL DEFAULT 50,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_contacts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  role_title text,
  phone text,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_applications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  submitted_at text NOT NULL,
  main_challenges text NOT NULL,
  current_tools text NOT NULL,
  pilot_type text NOT NULL,
  status text NOT NULL DEFAULT 'Applied'
);

CREATE TABLE IF NOT EXISTS pilot_projects (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Planning',
  start_date text,
  end_date text,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_software_assets (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  name text NOT NULL,
  vendor text NOT NULL,
  version text NOT NULL,
  dependencies_count integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'Unknown',
  trust_score integer NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_passport_reports (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  asset_id text NOT NULL,
  report_type text NOT NULL,
  report_path text NOT NULL,
  generated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_feedback_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  contact_name text NOT NULL,
  comment text NOT NULL,
  rating integer NOT NULL DEFAULT 0,
  submitted_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_meetings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  title text NOT NULL,
  scheduled_at text NOT NULL,
  notes text,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_feature_requests (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'Suggested',
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_conversion_tracking (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  org_id text NOT NULL,
  converted_at text,
  deal_value integer NOT NULL DEFAULT 0,
  previous_status text,
  notes text,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 14. AI AGENT SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-default',
  agent_id text NOT NULL,
  passport_id text NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  progress integer NOT NULL DEFAULT 0,
  result text,
  error text,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  locked_at timestamp,
  locked_by text,
  next_attempt_at timestamp DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id serial PRIMARY KEY,
  job_id text NOT NULL,
  agent_id text NOT NULL,
  message text NOT NULL,
  level text NOT NULL DEFAULT 'Info',
  timestamp timestamp DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 15. DEVELOPER PRODUCTIVITY TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  github_username text,
  bio text
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id integer NOT NULL REFERENCES app_users(id),
  github_url text,
  description text
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  project_id text NOT NULL REFERENCES projects(id),
  description text,
  due_date timestamp
);

CREATE TABLE IF NOT EXISTS snippets (
  id text PRIMARY KEY,
  title text NOT NULL,
  language text NOT NULL,
  content text NOT NULL,
  creator_id integer NOT NULL REFERENCES app_users(id),
  description text,
  tags text
);

CREATE TABLE IF NOT EXISTS work_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES app_users(id),
  last_active_at timestamp NOT NULL,
  active_file_path text,
  active_branch text
);

-- ============================================================================
-- 16. MIGRATION LEDGER (Self-tracking for idempotency)
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  description text NOT NULL,
  executed_at timestamp DEFAULT CURRENT_TIMESTAMP,
  execution_duration_ms integer
);

-- ============================================================================
-- COMMIT TRANSACTION
-- ============================================================================

COMMIT;

-- ============================================================================
-- ROLLBACK GUIDANCE (for emergency recovery only)
-- ============================================================================
-- To rollback this migration, you must manually drop all tables in reverse
-- dependency order. This should only be done before any production data exists:
--
-- DROP TABLE IF EXISTS work_sessions, snippets, tasks, projects, app_users;
-- DROP TABLE IF EXISTS agent_logs, agent_jobs;
-- DROP TABLE IF EXISTS pilot_conversion_tracking, pilot_feature_requests, pilot_meetings,
--   pilot_feedback_items, pilot_passport_reports, pilot_software_assets, pilot_projects,
--   pilot_applications, pilot_contacts, pilot_organizations;
-- DROP TABLE IF EXISTS audit_trail;
-- DROP TABLE IF EXISTS repository_scan_sources, repository_connections;
-- DROP TABLE IF EXISTS scan_findings, evidence_items;
-- DROP TABLE IF EXISTS scan_schedules, compliance_schedules;
-- DROP TABLE IF EXISTS billing, integrations;
-- DROP TABLE IF EXISTS credential_references;
-- DROP TABLE IF EXISTS in_app_notifications, alert_subscriptions;
-- DROP TABLE IF EXISTS collector_results, collector_jobs, monitoring_configurations;
-- DROP TRIGGER IF EXISTS trust_observations_immutable_update ON trust_observations;
-- DROP FUNCTION IF EXISTS prevent_trust_observation_mutation();
-- DROP TABLE IF EXISTS trust_observation_changes, trust_observations;
-- DROP TABLE IF EXISTS alerts, scans, passports, clients, users;
-- DROP TABLE IF EXISTS schema_migrations;
