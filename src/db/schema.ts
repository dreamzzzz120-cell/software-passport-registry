/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// 1. Users Table (for Auth with RBAC role and multi-tenant mapping)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
  role: text('role').notNull().default('Viewer'),
  companyName: text('company_name'),
  roleTitle: text('role_title'),
  numTechnicians: integer('num_technicians'),
  clientCount: integer('client_count'),
  primaryUseCase: text('primary_use_case'),
  onboarded: integer('onboarded').default(0),
  mfaEnabled: integer('mfa_enabled').default(0),
  mfaSecret: text('mfa_secret'),
  invitedBy: text('invited_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Clients Table (with tenant_id isolation)
export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
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
  softwareInventory: text('software_inventory').notNull().default('[]'),
  complianceStatus: text('compliance_status').notNull().default('[]'),
  teamMembers: text('team_members').notNull().default('[]'),
  activityTimeline: text('activity_timeline').notNull().default('[]'),
});

// 3. Passports Table (with tenant_id isolation)
export const passports = pgTable('passports', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('tenant-default'),
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
  sbom: text('sbom').notNull().default('[]'),
  evidence: text('evidence').notNull().default('[]'),
  vulnerabilities: text('vulnerabilities').notNull().default('[]'),
  timeline: text('timeline').notNull().default('[]'),
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
  jobId: text('job_id'),
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

// The remainder of this schema is unchanged from main.
// This file is intentionally kept structurally compatible with the existing tables.
