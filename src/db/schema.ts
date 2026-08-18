/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// 1. Users Table (for Auth with RBAC role and multi-tenant mapping)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth string UID
  email: text('email').notNull(),
  tenantId: text('tenant_id').notNull().default('tenant-default'), // Default tenant_id
  role: text('role').notNull().default('Viewer'), // RBAC Roles: Owner, Admin, Technician, Viewer, Client
  companyName: text('company_name'),
  roleTitle: text('role_title'),
  numTechnicians: integer('num_technicians'),
  clientCount: integer('client_count'),
  primaryUseCase: text('primary_use_case'),
  onboarded: integer('onboarded').default(0), // 0 = false, 1 = true
  mfaEnabled: integer('mfa_enabled').default(0), // 0 = false, 1 = true
  mfaSecret: text('mfa_secret'),
  invitedBy: text('invited_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Clients Table (with tenant_id isolation)
export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'), // Tenant isolation key
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  industry: text('industry').notNull(),
  trustScore: integer('trust_score').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('Unknown'),
  avatarColor: text('avatar_color').notNull().default('indigo'),
  subscriptionTier: text('subscription_tier').notNull().default('Standard'),
  joinedDate: text('joined_date').notNull(),
  teamCount: integer('team_count').notNull().default(1),
  passportCount: integer('passport_count').notNull().default(0),
  criticalRisksCount: integer('critical_risks_count').notNull().default(0),
  complianceProgress: integer('compliance_progress').notNull().default(0),
  softwareInventory: text('software_inventory').notNull().default('[]'), // JSON stringified array
  complianceStatus: text('compliance_status').notNull().default('[]'), // JSON stringified array
  teamMembers: text('team_members').notNull().default('[]'), // JSON stringified array
  activityTimeline: text('activity_timeline').notNull().default('[]'), // JSON stringified array
});

// 3. Passports Table (with tenant_id isolation)
export const passports = pgTable('passports', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'), // Tenant isolation key
  clientId: text('client_id'),
  name: text('name').notNull(),
  version: text('version').notNull(),
  publisher: text('publisher').notNull(),
  category: text('category').notNull(),
  overallScore: integer('overall_score').notNull().default(0),
  securityScore: integer('security_score').notNull().default(0),
  complianceScore: integer('compliance_score').notNull().default(0),
  vendorReputationScore: integer('vendor_reputation_score').notNull().default(0),
  releaseDate: text('release_date').notNull(),
  fileHash: text('file_hash').notNull(),
  licenseType: text('license_type').notNull(),
  aiSummary: text('ai_summary').notNull().default(''),
  sbom: text('sbom').notNull().default('[]'), // JSON stringified component array
  evidence: text('evidence').notNull().default('[]'), // JSON stringified evidence array
  vulnerabilities: text('vulnerabilities').notNull().default('[]'), // JSON stringified vulnerability array
  timeline: text('timeline').notNull().default('[]'), // JSON stringified timeline events
});

// 4. Scans Table (with tenant_id isolation)
export const scans = pgTable('scans', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  targetName: text('target_name').notNull(),
  scanType: text('scan_type').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  status: text('status').notNull().default('Pending'),
  durationMs: integer('duration_ms').notNull().default(0),
  findingsCount: integer('findings_count'),
  timestamp: text('timestamp').notNull(),
  clientName: text('client_name').notNull(),
});

// 5. Alerts Table (with tenant_id isolation)
export const alerts = pgTable('alerts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  title: text('title').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  clientName: text('client_name').notNull(),
  description: text('description').notNull(),
  timestamp: text('timestamp').notNull(),
  status: text('status').notNull().default('Active'),
  passportId: text('passport_id'),
  observationId: text('observation_id'),
  changeType: text('change_type'),
  deduplicationKey: text('deduplication_key'),
  firstObservedAt: text('first_observed_at'),
  lastObservedAt: text('last_observed_at'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  previousStatus: text('previous_status'),
  acknowledgedAt: text('acknowledged_at'),
  resolvedAt: text('resolved_at'),
  clientId: text('client_id'),
  assetId: text('asset_id'),
  sourceChangeEventId: text('source_change_event_id'),
  firstObservationId: text('first_observation_id'),
  acknowledgedBy: text('acknowledged_by'),
  resolvedBy: text('resolved_by'),
  evidenceIds: text('evidence_ids'),
  findingIds: text('finding_ids'),
  updatedAt: text('updated_at'),
});

// Remediation is operational work, not evidence of resolution. Verification states
// are deliberately persisted separately from the originating alert state.
export const remediationTasks = pgTable('remediation_tasks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  alertId: text('alert_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  priority: text('priority').notNull(),
  status: text('status').notNull().default('OPEN'),
  assigneeId: text('assignee_id'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
  readyForVerificationAt: text('ready_for_verification_at'),
  verifiedAt: text('verified_at'),
  verificationJobId: text('verification_job_id'),
});

export const remediationVerifications = pgTable('remediation_verifications', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull(), taskId: text('task_id').notNull(),
  clientId: text('client_id').notNull(), alertId: text('alert_id').notNull(),
  monitoringConfigurationId: text('monitoring_configuration_id').notNull(), collectorJobId: text('collector_job_id').notNull(),
  status: text('status').notNull().default('QUEUED'), observationId: text('observation_id'), evidenceIds: text('evidence_ids').notNull().default('[]'),
  evaluatorVersion: text('evaluator_version'), failureReason: text('failure_reason'), createdAt: text('created_at').notNull(), completedAt: text('completed_at'),
});

export const trustObservations = pgTable('trust_observations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  passportId: text('passport_id').notNull(),
  clientId: text('client_id').notNull(),
  assetId: text('asset_id').notNull(),
  schemaVersion: text('schema_version').notNull(),
  observationVersion: integer('observation_version').notNull(),
  generatedAt: text('generated_at').notNull(),
  previousObservationId: text('previous_observation_id'),
  evidenceIds: text('evidence_ids').notNull(),
  findingIds: text('finding_ids').notNull(),
  scoringPolicyVersion: text('scoring_policy_version').notNull(),
  confidencePolicyVersion: text('confidence_policy_version').notNull(),
  completeness: integer('completeness_basis_points').notNull(),
  knownDimensionCount: integer('known_dimension_count').notNull(),
  unknownDimensionCount: integer('unknown_dimension_count').notNull(),
  staleDimensionCount: integer('stale_dimension_count').notNull(),
  expiredDimensionCount: integer('expired_dimension_count').notNull(),
  canonicalPayloadHash: text('canonical_payload_hash').notNull(),
  immutablePayload: text('immutable_payload').notNull(),
  generationReason: text('generation_reason').notNull().default('manual'),
  generatedByActorId: text('generated_by_actor_id'),
  generatedByActorType: text('generated_by_actor_type').notNull().default('user'),
  collectorVersionMap: text('collector_version_map').notNull().default('{}'),
  partiallyKnownDimensionCount: integer('partially_known_dimension_count').notNull().default(0),
  unavailableDimensionCount: integer('unavailable_dimension_count').notNull().default(0),
  openFindingCount: integer('open_finding_count').notNull().default(0),
  persistedFindingCount: integer('persisted_finding_count').notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  createdAt: text('created_at').notNull().default(''),
});

export const trustObservationChanges = pgTable('trust_observation_changes', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  passportId: text('passport_id').notNull(),
  observationId: text('observation_id').notNull(),
  previousObservationId: text('previous_observation_id'),
  changeType: text('change_type').notNull(),
  subject: text('subject').notNull(),
  deduplicationKey: text('deduplication_key').notNull(),
  details: text('details').notNull(),
  createdAt: text('created_at').notNull(),
  dimension: text('dimension'),
  severity: text('severity').notNull().default('informational'),
  previousValue: text('previous_value').notNull().default('null'),
  currentValue: text('current_value').notNull().default('null'),
  evidenceIds: text('evidence_ids').notNull().default('[]'),
  findingIds: text('finding_ids').notNull().default('[]'),
  materialityPolicyVersion: text('materiality_policy_version').notNull().default('spr.materiality.v1'),
});

// Continuous monitoring configuration. Secrets are held separately and only a
// server-side credential reference is stored here.
export const monitoringConfigurations = pgTable('monitoring_configurations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  assetId: text('asset_id').notNull(),
  passportId: text('passport_id').notNull(),
  collectorId: text('collector_id').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectIdentifier: text('subject_identifier').notNull(),
  enabled: integer('enabled').notNull().default(1),
  scheduleSeconds: integer('schedule_seconds').notNull(),
  lastAttemptedAt: text('last_attempted_at'),
  lastSuccessfulAt: text('last_successful_at'),
  nextScheduledAt: text('next_scheduled_at').notNull(),
  credentialReferenceId: text('credential_reference_id'),
  failureCount: integer('failure_count').notNull().default(0),
  consecutiveFailureCount: integer('consecutive_failure_count').notNull().default(0),
  lastStatus: text('last_status').notNull().default('unknown'),
  freshnessPolicyId: text('freshness_policy_id').notNull(),
  confidencePolicyId: text('confidence_policy_id').notNull(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const collectorJobs = pgTable('collector_jobs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  assetId: text('asset_id').notNull(),
  passportId: text('passport_id').notNull(),
  monitoringConfigurationId: text('monitoring_configuration_id'),
  collectorId: text('collector_id').notNull(),
  collectorVersion: text('collector_version').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectIdentifier: text('subject_identifier').notNull(),
  scheduleSource: text('schedule_source').notNull(),
  observationWindow: text('observation_window').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  state: text('state').notNull().default('queued'),
  attemptNumber: integer('attempt_number').notNull().default(0),
  maximumAttempts: integer('maximum_attempts').notNull().default(3),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  heartbeatAt: text('heartbeat_at'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  nextAttemptAt: text('next_attempt_at').notNull(),
  safeErrorCode: text('safe_error_code'),
  safeErrorMessage: text('safe_error_message'),
});

export const collectorResults = pgTable('collector_results', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  assetId: text('asset_id').notNull(),
  passportId: text('passport_id').notNull(),
  jobId: text('job_id').notNull(),
  collectorId: text('collector_id').notNull(),
  collectorVersion: text('collector_version').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectIdentifier: text('subject_identifier').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at').notNull(),
  evidenceIds: text('evidence_ids').notNull().default('[]'),
  findingIds: text('finding_ids').notNull().default('[]'),
  verificationMethods: text('verification_methods').notNull().default('[]'),
  limitations: text('limitations').notNull().default('[]'),
  safeErrorCode: text('safe_error_code'),
  safeErrorMessage: text('safe_error_message'),
});

export const alertSubscriptions = pgTable('alert_subscriptions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id'),
  assetId: text('asset_id'),
  passportId: text('passport_id'),
  collectorId: text('collector_id'),
  alertTypes: text('alert_types').notNull(),
  minimumSeverity: text('minimum_severity').notNull(),
  enabled: integer('enabled').notNull().default(1),
  deliveryChannel: text('delivery_channel').notNull().default('in_app'),
  destinationReference: text('destination_reference'),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const inAppNotifications = pgTable('in_app_notifications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  alertId: text('alert_id').notNull(),
  deduplicationKey: text('deduplication_key').notNull(),
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
});

export const credentialReferences = pgTable('credential_references', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  provider: text('provider').notNull(),
  encryptedPayload: text('encrypted_payload').notNull(),
  encryptionKeyVersion: text('encryption_key_version').notNull(),
  state: text('state').notNull().default('active'),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 6. Integrations Table (with tenant_id isolation)
export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  name: text('name').notNull(),
  category: text('category').notNull(),
  icon: text('icon').notNull(),
  connected: integer('connected').notNull().default(0), // 0=false, 1=true
  description: text('description').notNull(),
  apiKeyHint: text('api_key_hint').notNull().default(''),
  lastSyncDate: text('last_sync_date').notNull(),
});

// 7. Billing Table (with tenant_id isolation and Stripe tracking)
export const billing = pgTable('billing', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  clientName: text('client_name').notNull(),
  activePassportsCount: integer('active_passports_count').notNull().default(0),
  pricePerPassport: integer('price_per_passport').notNull().default(45),
  extraFees: integer('extra_fees').notNull().default(0),
  billingCycle: text('billing_cycle').notNull().default('Monthly'),
  totalAmount: integer('total_amount').notNull().default(0),
  status: text('status').notNull().default('Pending'), // Paid, Pending, Overdue
  stripeSessionId: text('stripe_session_id'), // Associated Stripe checkout session ID
});

// 8. Compliance Schedules Table (with tenant_id isolation)
export const complianceSchedules = pgTable('compliance_schedules', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  clientId: text('client_id').notNull(),
  frequency: text('frequency').notNull(), // Daily, Weekly, Monthly
  targetEmail: text('target_email').notNull(),
  lastAuditAt: text('last_audit_at'),
  nextAuditAt: text('next_audit_at'),
  status: text('status').notNull().default('Active'),
  createdAt: text('created_at').notNull(),
});

// 9. Pilot Organizations Table
export const pilotOrganizations = pgTable('pilot_organizations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  name: text('name').notNull(),
  industry: text('industry').notNull(),
  website: text('website'),
  size: text('size'), // e.g. 50-200 employees
  status: text('status').notNull().default('Prospect'), // Prospect, Applied, Under Review, Approved, Active Pilot, Completed, Converted, Declined
  engagementScore: integer('engagement_score').notNull().default(50),
  conversionProbability: integer('conversion_probability').notNull().default(50),
  createdAt: timestamp('created_at').defaultNow(),
});

// 10. Pilot Contacts Table
export const pilotContacts = pgTable('pilot_contacts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  roleTitle: text('role_title'),
  phone: text('phone'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 11. Pilot Applications Table
export const pilotApplications = pgTable('pilot_applications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  submittedAt: text('submitted_at').notNull(),
  mainChallenges: text('main_challenges').notNull(),
  currentTools: text('current_tools').notNull(),
  pilotType: text('pilot_type').notNull(), // MSP partner, Software company, Enterprise customer
  status: text('status').notNull().default('Applied'),
});

// 12. Pilot Projects Table
export const pilotProjects = pgTable('pilot_projects', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('Planning'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 13. Pilot Software Assets Table
export const pilotSoftwareAssets = pgTable('pilot_software_assets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  vendor: text('vendor').notNull(),
  version: text('version').notNull(),
  dependenciesCount: integer('dependencies_count').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('Unknown'),
  trustScore: integer('trust_score').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// 14. Pilot Passport Reports Table
export const pilotPassportReports = pgTable('pilot_passport_reports', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  assetId: text('asset_id').notNull(),
  reportType: text('report_type').notNull(), // e.g. 'NIST Mapping', 'Risk Assessment'
  reportPath: text('report_path').notNull(),
  generatedAt: text('generated_at').notNull(),
});

// 15. Pilot Feedback Items Table
export const pilotFeedbackItems = pgTable('pilot_feedback_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  contactName: text('contact_name').notNull(),
  comment: text('comment').notNull(),
  rating: integer('rating').notNull().default(0),
  submittedAt: text('submitted_at').notNull(),
});

// 16. Pilot Meetings Table
export const pilotMeetings = pgTable('pilot_meetings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  scheduledAt: text('scheduled_at').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 17. Pilot Feature Requests Table
export const pilotFeatureRequests = pgTable('pilot_feature_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('Suggested'), // Suggested, Under Review, Planned, Completed
  createdAt: timestamp('created_at').defaultNow(),
});

// 18. Pilot Conversion Tracking Table
export const pilotConversionTracking = pgTable('pilot_conversion_tracking', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  orgId: text('org_id').notNull(),
  convertedAt: text('converted_at'),
  dealValue: integer('deal_value').notNull().default(0),
  previousStatus: text('previous_status'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 19. Agent Jobs Table (AI Agent System Async Jobs)
export const agentJobs = pgTable('agent_jobs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  agentId: text('agent_id').notNull(), // e.g. 'identity-ai', 'security-ai'
  passportId: text('passport_id').notNull(),
  jobType: text('job_type').notNull(), // e.g. 'compliance_scan', 'vulnerability_remediation'
  status: text('status').notNull().default('Pending'), // Pending, Running, Completed, Failed
  progress: integer('progress').notNull().default(0),
  result: text('result'), // JSON stringified result or summary
  error: text('error'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lockedAt: timestamp('locked_at'),
  lockedBy: text('locked_by'),
  nextAttemptAt: timestamp('next_attempt_at').defaultNow(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 20. Agent Logs Table
export const agentLogs = pgTable('agent_logs', {
  id: serial('id').primaryKey(),
  jobId: text('job_id').notNull(),
  agentId: text('agent_id').notNull(),
  message: text('message').notNull(),
  level: text('level').notNull().default('Info'), // Info, Warning, Error
  timestamp: timestamp('timestamp').defaultNow(),
});

// 21. Scan Schedules Table
export const scanSchedules = pgTable('scan_schedules', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  assetId: text('asset_id').notNull(),
  assetHostName: text('asset_host_name').notNull(),
  assetType: text('asset_type').notNull(),
  clientName: text('client_name').notNull(),
  frequency: text('frequency').notNull(),
  scanType: text('scan_type').notNull(),
  status: text('status').notNull().default('Active'),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at').notNull(),
  createdAt: text('created_at').notNull(),
});

// 22. Evidence Items Table (Traceable pieces of cryptographic and audit proof)
export const evidenceItems = pgTable('evidence_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  assetId: text('asset_id').notNull(), // Links to passports.id
  name: text('name').notNull(),
  type: text('type').notNull(), // Signature, Audit Report, Build Log, Security Scan, Attestation
  verified: integer('verified').notNull().default(0), // 0=false, 1=true
  status: text('status').notNull().default('UNKNOWN'),
  signer: text('signer').notNull(),
  timestamp: text('timestamp').notNull(),
  hash: text('hash').notNull(),
  rawContent: text('raw_content').notNull().default(''), // Collected raw data payload
  engineId: text('engine_id').notNull(), // e.g. identity-ai, code-ai, dependency-ai
  verificationFailureReason: text('verification_failure_reason'),
});

// 23. Scan Findings Table (Granular findings detected during scanning)
export const scanFindings = pgTable('scan_findings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  assetId: text('asset_id').notNull(), // Links to passports.id
  jobId: text('job_id').notNull(), // Links to agent_jobs.id
  severity: text('severity').notNull(), // Critical, High, Medium, Low
  category: text('category').notNull(), // Vulnerability, Compliance Gap, Signature Failure, Policy Violation
  title: text('title').notNull(),
  description: text('description').notNull(),
  component: text('component'),
  fixedVersion: text('fixed_version'),
  status: text('status').notNull().default('Open'), // Open, Mitigated, Resolved, Snoozed
  detectedAt: text('detected_at').notNull(),
  engineId: text('engine_id').notNull(), // Module that discovered it
});

export const repositoryConnections = pgTable('repository_connections', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  provider: text('provider').notNull(),
  installationId: text('installation_id').notNull(),
  label: text('label').notNull(),
  accessMode: text('access_mode').notNull().default('public'),
  status: text('status').notNull().default('Active'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const repositoryScanSources = pgTable('repository_scan_sources', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().unique(),
  tenantId: text('tenant_id').notNull(),
  connectionId: text('connection_id').notNull(),
  provider: text('provider').notNull(),
  repositoryOwner: text('repository_owner').notNull(),
  repositoryName: text('repository_name').notNull(),
  requestedRef: text('requested_ref'),
  resolvedCommitSha: text('resolved_commit_sha'),
  repositorySubdirectory: text('repository_subdirectory').notNull().default(''),
  scannerConfiguration: text('scanner_configuration').notNull().default('syft:1.49.0:cyclonedx-json+osv:v1'),
  defaultBranch: text('default_branch'),
  visibility: text('visibility'),
  acquiredAt: timestamp('acquired_at'),
  sourceDescriptorHash: text('source_descriptor_hash'),
  manifestPaths: text('manifest_paths').notNull().default('[]'),
  manifestInventoryHash: text('manifest_inventory_hash'),
  rawSbomHash: text('raw_sbom_hash'),
  sbomDocument: text('sbom_document'),
  normalizedComponents: text('normalized_components').notNull().default('[]'),
  normalizedComponentsHash: text('normalized_components_hash'),
  finalFindingsHash: text('final_findings_hash'),
  scannerName: text('scanner_name'),
  scannerVersion: text('scanner_version'),
  scannerMode: text('scanner_mode'),
  scannerStartedAt: timestamp('scanner_started_at'),
  scannerEndedAt: timestamp('scanner_ended_at'),
  scannerExitCode: integer('scanner_exit_code'),
  scannerErrorCategory: text('scanner_error_category'),
  temporaryDirectoryRemoved: integer('temporary_directory_removed').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// 24. Cryptographic Tamper-Proof Audit Trail Table (Postgres-persisted Ledger blocks)
export const auditTrail = pgTable('audit_trail', {
  id: serial('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  action: text('action').notNull(),
  timestamp: text('timestamp').notNull(),
  actor: text('actor').notNull(),
  payload: text('payload').notNull(),
  previousHash: text('previous_hash').notNull(),
  currentHash: text('current_hash').notNull(),
});

// Additional developer productivity tables from requested GraphQL schema
export const appUsers = pgTable('app_users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  githubUsername: text('github_username'),
  bio: text('bio'),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: integer('owner_id').notNull().references(() => appUsers.id),
  githubUrl: text('github_url'),
  description: text('description'),
});

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('Open'),
  projectId: text('project_id').notNull().references(() => projects.id),
  description: text('description'),
  dueDate: timestamp('due_date'),
});

export const snippets = pgTable('snippets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  language: text('language').notNull(),
  content: text('content').notNull(),
  creatorId: integer('creator_id').notNull().references(() => appUsers.id),
  description: text('description'),
  tags: text('tags'),
});

export const workSessions = pgTable('work_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => appUsers.id),
  lastActiveAt: timestamp('last_active_at').notNull(),
  activeFilePath: text('active_file_path'),
  activeBranch: text('active_branch'),
});

export const appUserRelations = relations(appUsers, ({ many }) => ({
  projects: many(projects),
  snippets: many(snippets),
  workSessions: many(workSessions),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  owner: one(appUsers, {
    fields: [projects.ownerId],
    references: [appUsers.id],
  }),
  tasks: many(tasks),
}));

export const taskRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
}));

export const snippetRelations = relations(snippets, ({ one }) => ({
  creator: one(appUsers, {
    fields: [snippets.creatorId],
    references: [appUsers.id],
  }),
}));

export const workSessionRelations = relations(workSessions, ({ one }) => ({
  user: one(appUsers, {
    fields: [workSessions.userId],
    references: [appUsers.id],
  }),
}));
