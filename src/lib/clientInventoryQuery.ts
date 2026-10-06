import { sql } from 'drizzle-orm';

// Membership comes from passports.client_id, never the stale client cache.
export function clientInventoryQuery(tenantId: string, clientScope: string | null) {
  return sql`
    SELECT c.id, c.name, c.domain, c.industry,
      c.trust_score AS "trustScore", c.risk_level AS "riskLevel",
      c.avatar_color AS "avatarColor", c.subscription_tier AS "subscriptionTier",
      c.joined_date AS "joinedDate", c.team_count AS "teamCount",
      (SELECT count(*)::int FROM passports p WHERE p.tenant_id=c.tenant_id AND p.client_id=c.id) AS "passportCount",
      (SELECT count(*)::int FROM scan_findings f JOIN passports p ON p.id=f.asset_id AND p.tenant_id=f.tenant_id
       WHERE p.tenant_id=c.tenant_id AND p.client_id=c.id AND lower(f.severity) IN ('critical','high')
         AND lower(f.status) NOT IN ('resolved','closed','verified')) AS "criticalRisksCount",
      c.compliance_progress AS "complianceProgress",
      COALESCE((SELECT json_agg(json_build_object(
        'passportId', p.id, 'name', p.name, 'version', p.version,
        'overallScore', CASE WHEN p.verification_status='verified' THEN p.overall_score ELSE NULL END,
        'riskStatus', CASE WHEN EXISTS (SELECT 1 FROM scan_findings f WHERE f.tenant_id=p.tenant_id AND f.asset_id=p.id
          AND lower(f.severity) IN ('critical','high') AND lower(f.status) NOT IN ('resolved','closed','verified')) THEN 'Critical' ELSE 'Unknown' END,
        'lastScanDate', (SELECT max(j.updated_at)::text FROM agent_jobs j WHERE j.tenant_id=p.tenant_id
          AND j.passport_id=p.id AND j.job_type='repository_scan' AND j.status='Completed')
      ) ORDER BY p.name) FROM passports p WHERE p.tenant_id=c.tenant_id AND p.client_id=c.id), '[]'::json) AS "softwareInventory",
      c.compliance_status AS "complianceStatus", c.team_members AS "teamMembers", c.activity_timeline AS "activityTimeline"
    FROM clients c
    WHERE c.tenant_id=${tenantId} AND (${clientScope}::text IS NULL OR c.id=${clientScope})
    ORDER BY c.joined_date DESC
  `;
}
