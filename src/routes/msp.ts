import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry, verifyAuditChain } from '../security/audit-log.ts';

const assignSchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  technicianUserId: z.number().int().positive().optional(),
  technicianDisplay: z.string().trim().min(1).max(255),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

export function createMspRouter() {
  const router = Router();

  // MSP operational surfaces are tenant-private and must never be cached by a browser, proxy, or shared CDN.
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return next();
  });

  router.get('/assignments', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const isClient = req.user!.role === 'Client';
      const clientId = req.user!.clientId;
      if (isClient && !clientId) return res.status(403).json({ error: 'Client account has invalid client configuration' });
      const rows = await db.execute(sql`SELECT id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at FROM client_assignments WHERE tenant_id=${tenantId} AND (${isClient ? sql`client_id = ${clientId}` : sql`TRUE`}) ORDER BY updated_at DESC`);
      return res.json({ assignments: (rows as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.put('/assignments', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const client = (await db.execute(sql`SELECT id FROM clients WHERE id=\${parsed.data.clientId} AND tenant_id=\${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
      // Never trust a caller-supplied technician id as display metadata.
      // Resolve it inside the tenant-scoped transaction and require an
      // MSP-capable role, preventing cross-tenant assignment and assignment
      // of Client/Viewer accounts as technicians.
      if (parsed.data.technicianUserId !== undefined) {
        const technician = (await db.execute(sql`SELECT id FROM users WHERE id=\${parsed.data.technicianUserId} AND tenant_id=\${tenantId} AND role IN ('Owner','Admin','Operator','Technician') LIMIT 1`) as any).rows?.[0];
        if (!technician) return res.status(400).json({ error: 'INVALID_TECHNICIAN' });
      }
      const now = new Date().toISOString();
      const row = (await db.execute(sql`
        INSERT INTO client_assignments (id, tenant_id, client_id, technician_user_id, technician_display, assigned_by, created_at, updated_at)
        VALUES (${id('assign')}, ${tenantId}, ${parsed.data.clientId}, ${parsed.data.technicianUserId ?? null}, ${parsed.data.technicianDisplay}, ${req.user!.email}, ${now}, ${now})
        ON CONFLICT (tenant_id, client_id) DO UPDATE SET technician_user_id=EXCLUDED.technician_user_id, technician_display=EXCLUDED.technician_display, assigned_by=EXCLUDED.assigned_by, updated_at=EXCLUDED.updated_at
        RETURNING id, client_id, technician_display
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'client.technician_assigned', actor: req.user!.email, payload: { clientId: parsed.data.clientId, technicianDisplay: parsed.data.technicianDisplay } });
      return res.status(200).json(row);
    } catch (error) { return next(error); }
  });

  router.delete('/assignments/:clientId', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`DELETE FROM client_assignments WHERE tenant_id=${tenantId} AND client_id=${req.params.clientId} RETURNING id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'ASSIGNMENT_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'client.technician_unassigned', actor: req.user!.email, payload: { clientId: req.params.clientId } });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  // Full tenant-scoped MSP audit export. Internal MSP roles only.
  router.get('/audit-export', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const [
        tenant, clients, passports, scans, findings, evidence, alerts, remediationTasks,
        remediationVerifications, observations, observationChanges, monitoring, collectorJobs,
        collectorResults, repositorySources, schedules, auditTrail, auditIntegrity,
      ] = await Promise.all([
        db.execute(sql`SELECT id, name, created_at AS "createdAt" FROM tenants WHERE id=${tenantId} LIMIT 1`),
        db.execute(sql`SELECT id, name, domain, industry, trust_score AS "trustScore", risk_level AS "riskLevel", subscription_tier AS "subscriptionTier", joined_date AS "joinedDate", passport_count AS "passportCount", critical_risks_count AS "criticalRisksCount", compliance_progress AS "complianceProgress" FROM clients WHERE tenant_id=${tenantId} ORDER BY name ASC`),
        db.execute(sql`SELECT id, name, version, publisher, category, client_id AS "clientId", overall_score AS "overallScore", security_score AS "securityScore", compliance_score AS "complianceScore", vendor_reputation_score AS "vendorReputationScore", confidence_score AS "confidenceScore", evidence_completeness AS "evidenceCompleteness", verification_status AS "verificationStatus", release_date AS "releaseDate", file_hash AS "fileHash", license_type AS "licenseType" FROM passports WHERE tenant_id=${tenantId} ORDER BY name ASC`),
        db.execute(sql`SELECT id, target_name AS "targetName", scan_type AS "scanType", triggered_by AS "triggeredBy", status, duration_ms AS "durationMs", findings_count AS "findingsCount", timestamp, client_name AS "clientName" FROM scans WHERE tenant_id=${tenantId} ORDER BY timestamp DESC LIMIT 10000`),
        db.execute(sql`SELECT id, asset_id AS "assetId", job_id AS "jobId", severity, category, title, description, component, fixed_version AS "fixedVersion", status, detected_at AS "detectedAt", engine_id AS "engineId", vex_status AS "vexStatus", reachability, confidence, state, psa_ticket_id AS "psaTicketId", last_psa_sync_at AS "lastPsaSyncAt", updated_at AS "updatedAt" FROM scan_findings WHERE tenant_id=${tenantId} ORDER BY detected_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, asset_id AS "assetId", name, type, verified, status, signer, timestamp, hash, engine_id AS "engineId", verification_failure_reason AS "verificationFailureReason" FROM evidence_items WHERE tenant_id=${tenantId} ORDER BY timestamp DESC LIMIT 10000`),
        db.execute(sql`SELECT id, title, severity, category, client_name AS "clientName", description, timestamp, status, passport_id AS "passportId", observation_id AS "observationId", client_id AS "clientId", asset_id AS "assetId", first_observed_at AS "firstObservedAt", last_observed_at AS "lastObservedAt", occurrence_count AS "occurrenceCount", acknowledged_at AS "acknowledgedAt", resolved_at AS "resolvedAt", updated_at AS "updatedAt" FROM alerts WHERE tenant_id=${tenantId} ORDER BY timestamp DESC LIMIT 10000`),
        db.execute(sql`SELECT id, client_id AS "clientId", alert_id AS "alertId", title, description, priority, status, assignee_id AS "assigneeId", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", ready_for_verification_at AS "readyForVerificationAt", verified_at AS "verifiedAt", verification_job_id AS "verificationJobId" FROM remediation_tasks WHERE tenant_id=${tenantId} ORDER BY updated_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, task_id AS "taskId", client_id AS "clientId", alert_id AS "alertId", monitoring_configuration_id AS "monitoringConfigurationId", collector_job_id AS "collectorJobId", status, observation_id AS "observationId", evidence_ids AS "evidenceIds", evaluator_version AS "evaluatorVersion", failure_reason AS "failureReason", created_at AS "createdAt", completed_at AS "completedAt" FROM remediation_verifications WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, passport_id AS "passportId", client_id AS "clientId", asset_id AS "assetId", schema_version AS "schemaVersion", observation_version AS "observationVersion", generated_at AS "generatedAt", previous_observation_id AS "previousObservationId", evidence_ids AS "evidenceIds", finding_ids AS "findingIds", scoring_policy_version AS "scoringPolicyVersion", confidence_policy_version AS "confidencePolicyVersion", completeness_basis_points AS "completenessBasisPoints", known_dimension_count AS "knownDimensionCount", unknown_dimension_count AS "unknownDimensionCount", stale_dimension_count AS "staleDimensionCount", expired_dimension_count AS "expiredDimensionCount", canonical_payload_hash AS "canonicalPayloadHash", generation_reason AS "generationReason", generated_by_actor_type AS "generatedByActorType", open_finding_count AS "openFindingCount", persisted_finding_count AS "persistedFindingCount" FROM trust_observations WHERE tenant_id=${tenantId} ORDER BY generated_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, passport_id AS "passportId", observation_id AS "observationId", previous_observation_id AS "previousObservationId", change_type AS "changeType", subject, deduplication_key AS "deduplicationKey", details, created_at AS "createdAt", dimension, severity, evidence_ids AS "evidenceIds", finding_ids AS "findingIds" FROM trust_observation_changes WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, client_id AS "clientId", asset_id AS "assetId", passport_id AS "passportId", collector_id AS "collectorId", subject_type AS "subjectType", subject_identifier AS "subjectIdentifier", enabled, schedule_seconds AS "scheduleSeconds", last_attempted_at AS "lastAttemptedAt", last_successful_at AS "lastSuccessfulAt", next_scheduled_at AS "nextScheduledAt", failure_count AS "failureCount", consecutive_failure_count AS "consecutiveFailureCount", last_status AS "lastStatus", created_at AS "createdAt", updated_at AS "updatedAt" FROM monitoring_configurations WHERE tenant_id=${tenantId} ORDER BY updated_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, client_id AS "clientId", asset_id AS "assetId", passport_id AS "passportId", monitoring_configuration_id AS "monitoringConfigurationId", collector_id AS "collectorId", collector_version AS "collectorVersion", subject_type AS "subjectType", subject_identifier AS "subjectIdentifier", schedule_source AS "scheduleSource", observation_window AS "observationWindow", idempotency_key AS "idempotencyKey", state, attempt_number AS "attemptNumber", maximum_attempts AS "maximumAttempts", created_at AS "createdAt", started_at AS "startedAt", completed_at AS "completedAt", next_attempt_at AS "nextAttemptAt", safe_error_code AS "safeErrorCode", safe_error_message AS "safeErrorMessage" FROM collector_jobs WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, client_id AS "clientId", asset_id AS "assetId", passport_id AS "passportId", job_id AS "jobId", collector_id AS "collectorId", collector_version AS "collectorVersion", subject_type AS "subjectType", subject_identifier AS "subjectIdentifier", status, started_at AS "startedAt", completed_at AS "completedAt", evidence_ids AS "evidenceIds", finding_ids AS "findingIds", verification_methods AS "verificationMethods", limitations, safe_error_code AS "safeErrorCode", safe_error_message AS "safeErrorMessage" FROM collector_results WHERE tenant_id=${tenantId} ORDER BY started_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, job_id AS "jobId", connection_id AS "connectionId", provider, repository_owner AS "repositoryOwner", repository_name AS "repositoryName", requested_ref AS "requestedRef", resolved_commit_sha AS "resolvedCommitSha", repository_subdirectory AS "repositorySubdirectory", scanner_configuration AS "scannerConfiguration", default_branch AS "defaultBranch", visibility, acquired_at AS "acquiredAt", source_descriptor_hash AS "sourceDescriptorHash", manifest_paths AS "manifestPaths", manifest_inventory_hash AS "manifestInventoryHash", raw_sbom_hash AS "rawSbomHash", normalized_components_hash AS "normalizedComponentsHash", final_findings_hash AS "finalFindingsHash", scanner_name AS "scannerName", scanner_version AS "scannerVersion", scanner_mode AS "scannerMode", scanner_started_at AS "scannerStartedAt", scanner_ended_at AS "scannerEndedAt", scanner_exit_code AS "scannerExitCode", scanner_error_category AS "scannerErrorCategory", temporary_directory_removed AS "temporaryDirectoryRemoved", created_at AS "createdAt" FROM repository_scan_sources WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, client_id AS "clientId", frequency, target_email AS "targetEmail", status, last_audit_at AS "lastAuditAt", next_audit_at AS "nextAuditAt", created_at AS "createdAt" FROM compliance_schedules WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 10000`),
        db.execute(sql`SELECT id, action, timestamp, actor, payload, previous_hash AS "previousHash", current_hash AS "currentHash" FROM audit_trail WHERE tenant_id=${tenantId} ORDER BY id DESC LIMIT 10000`),
        verifyAuditChain(db, tenantId),
      ]);
      const rows = (value: any) => value?.rows ?? [];
      const payload = {
        schemaVersion: 'spr.msp.audit-export.v1',
        generatedAt: new Date().toISOString(),
        tenantId,
        tenant: rows(tenant)[0] ?? { id: tenantId },
        counts: {
          clients: rows(clients).length, passports: rows(passports).length, scans: rows(scans).length,
          findings: rows(findings).length, evidence: rows(evidence).length, alerts: rows(alerts).length,
          remediationTasks: rows(remediationTasks).length, remediationVerifications: rows(remediationVerifications).length,
          observations: rows(observations).length, observationChanges: rows(observationChanges).length,
          monitoringConfigurations: rows(monitoring).length, collectorJobs: rows(collectorJobs).length,
          collectorResults: rows(collectorResults).length, repositorySources: rows(repositorySources).length,
          complianceSchedules: rows(schedules).length, auditEvents: rows(auditTrail).length,
        },
        auditIntegrity,
        clients: rows(clients), passports: rows(passports), scans: rows(scans), findings: rows(findings),
        evidence: rows(evidence), alerts: rows(alerts), remediationTasks: rows(remediationTasks),
        remediationVerifications: rows(remediationVerifications), observations: rows(observations),
        observationChanges: rows(observationChanges), monitoringConfigurations: rows(monitoring),
        collectorJobs: rows(collectorJobs), collectorResults: rows(collectorResults),
        repositorySources: rows(repositorySources), complianceSchedules: rows(schedules), auditTrail: rows(auditTrail),
        limitations: [
          'Recorded application evidence only; this export is not a certification or independent auditor opinion.',
          'Collections are capped at 10,000 records per collection.',
          'Only tenant-scoped tables represented by the current production schema are exported; unsupported external evidence is not invented.',
        ],
      };
      // Bind the export hash to the tenant and actor so a copied JSON artifact cannot be mistaken for another workspace's export.
      const exportHash = crypto.createHash('sha256').update(JSON.stringify({ tenantId, actor: req.user!.uid, payload })).digest('hex');
      await appendAuditEntry(db, { tenantId, action: 'msp.audit_export.generated', actor: req.user!.email, payload: { exportHash, format: 'json+pdf-source', counts: payload.counts } });
      res.setHeader('X-SPR-Audit-Export-Hash', exportHash);
      return res.json({ ...payload, exportHash });
    } catch (error) { return next(error); }
  });

  // MSP commercial usage is measured in Active Passports: unique passports
  // with enabled continuous integration monitoring. This deliberately excludes
  // one-off scans and historical/inactive passports from the billable meter.
  router.get('/usage', requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const db = req.db!;
      const subscription = (await db.execute(sql`SELECT plan, status, client_limit AS "activePassportLimit" FROM tenant_subscriptions WHERE tenant_id=${tenantId} LIMIT 1`) as any).rows?.[0] ?? null;
      const usage = (await db.execute(sql`SELECT COUNT(DISTINCT passport_id)::int AS "activePassports" FROM monitoring_configurations WHERE tenant_id=${tenantId} AND subject_type='integration_provider' AND enabled=true`) as any).rows?.[0];
      const activePassports = Number(usage?.activePassports ?? 0);
      const limit = subscription?.activePassportLimit == null ? null : Number(subscription.activePassportLimit);
      return res.json({
        billingUnit: 'active_passport',
        definition: 'Unique passport with at least one enabled integration-monitoring configuration.',
        plan: subscription?.plan ?? null,
        subscriptionStatus: subscription?.status ?? 'none',
        activePassports,
        includedActivePassports: limit,
        remaining: limit == null ? null : Math.max(0, limit - activePassports),
        overLimit: limit != null && activePassports > limit,
      });
    } catch (error) { return next(error); }
  });

  return router;
}
