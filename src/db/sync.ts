/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { sql } from 'drizzle-orm';
import { db } from './index.ts';

/**
 * Atomically purges all tenant-owned data. This is intentionally implemented
 * as one database transaction: a failed deletion must roll back rather than
 * leaving a tenant partially erased.
 */
export async function offboardTenantData(tenantId: string) {
  if (!tenantId || tenantId.length > 256) throw new Error('Invalid tenant ID');

  return db.transaction(async (tx) => {
    console.log(`[Tenant Lifecycle Manager] Purging all database records for tenant: ${tenantId}...`);

    // Delete dependents first. These tables intentionally use tenant_id as an
    // additional defense even where application-level ownership checks exist.
    const tenantTables = [
      'spr_webhook_deliveries',
      'remediation_verifications',
      'trust_observation_changes',
      'collector_results',
      'collector_jobs',
      'alert_subscriptions',
      'monitoring_configurations',
      'remediation_tasks',
      'trust_observations',
      'evidence_items',
      'scan_findings',
      'audit_trail',
      'alerts',
      'scans',
      'passports',
      'clients',
      'credential_references',
      'spr_api_keys',
      'spr_webhooks',
      'software_registry',
      'integrations',
      'billing',
      'users',
    ];

    for (const table of tenantTables) {
      await tx.execute(sql.raw(`DELETE FROM "${table}" WHERE tenant_id = '${tenantId.replaceAll("'", "''")}'`));
    }

    console.log(`[Tenant Lifecycle Manager] Offboarding completed atomically for ${tenantId}.`);
    return true;
  }).catch((error) => {
    console.error(`[Tenant Lifecycle Manager Error] Tenant ${tenantId} purge rolled back:`, error);
    throw new Error('Tenant offboarding database purge operation failed.');
  });
}
