/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './index.ts';
import { clients, passports, scans, alerts, integrations, billing, users, evidenceItems, scanFindings, auditTrail } from './schema.ts';
import { eq } from 'drizzle-orm';

/**
 * Cascade-deletes all data belonging to a tenant.
 * Used for data offboarding/retention controls.
 */
export async function offboardTenantData(tenantId: string) {
  try {
    console.log(`[Tenant Lifecycle Manager] Purging all database records for tenant: ${tenantId}...`);

    await db.delete(clients).where(eq(clients.tenantId, tenantId));
    await db.delete(passports).where(eq(passports.tenantId, tenantId));
    await db.delete(scans).where(eq(scans.tenantId, tenantId));
    await db.delete(alerts).where(eq(alerts.tenantId, tenantId));
    await db.delete(integrations).where(eq(integrations.tenantId, tenantId));
    await db.delete(billing).where(eq(billing.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(evidenceItems).where(eq(evidenceItems.tenantId, tenantId));
    await db.delete(scanFindings).where(eq(scanFindings.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));

    console.log(`[Tenant Lifecycle Manager] Offboarding completed. All data for ${tenantId} has been securely erased.`);
    return true;
  } catch (error) {
    console.error(`[Tenant Lifecycle Manager Error] Failed offboarding tenant ${tenantId}:`, error);
    throw new Error('Tenant offboarding database purge operation failed.');
  }
}
