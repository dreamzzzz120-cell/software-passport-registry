/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Outbound producer: a finding becomes a ConnectWise ticket, and the ticket id
// is written back so the inbound webhook can find its way home.
//
// The invariant: psa_ticket_id is written ONLY after ConnectWise has returned a
// real id. Every failure leaves the column null, which means the finding is
// simply un-ticketed and can be retried -- as opposed to carrying an id that
// matches nothing, which is unrecoverable without manual reconciliation, since
// the inbound route resolves tickets through (tenant_id, psa_ticket_id).
//
// The ticket body deliberately carries no finding detail beyond severity and
// category. A PSA ticket is visible to everyone on the service board, and the
// full description, affected component and evidence are the paid Passport.

import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../../middleware/tenant-scope.ts';
import { ConnectWiseError } from './types.ts';
import type { ConnectWiseClient } from './client.ts';

export interface TicketableFinding {
  id: string;
  severity: string;
  category: string;
  assetId: string;
  psaTicketId: string | null;
}

export type ProduceOutcome =
  | { produced: true; ticketId: string }
  | { produced: false; code: 'ALREADY_TICKETED' | ConnectWiseError['code']; reason: string };

export function buildTicketRequest(finding: TicketableFinding) {
  return {
    summary: `SPR: ${finding.severity} ${finding.category} finding on asset ${finding.assetId}`,
    detail: [
      `Software Passport Registry observed a ${String(finding.severity).toLowerCase()} ${finding.category} finding.`,
      `Asset: ${finding.assetId}`,
      `Finding reference: ${finding.id}`,
      '',
      'Full description, affected component, evidence and remediation are in the Software Passport.',
      'Resolving or closing this ticket records a claim in SPR; SPR re-scans to verify it. Closing the',
      'ticket does not by itself mark the finding as fixed.',
    ].join('\n'),
  };
}

/**
 * Create the ticket and record its id, inside the caller's tenant-scoped
 * connection so the write stays within the tenant's RLS boundary.
 */
export async function produceTicketForFinding(
  scoped: ScopedDb,
  tenantId: string,
  finding: TicketableFinding,
  client: ConnectWiseClient,
): Promise<ProduceOutcome> {
  // Idempotence: a finding already carrying a ticket is never ticketed twice,
  // and (tenant_id, psa_ticket_id) is uniquely indexed as a second line of
  // defence against a concurrent producer.
  if (finding.psaTicketId) {
    return { produced: false, code: 'ALREADY_TICKETED', reason: `Finding ${finding.id} already has ticket ${finding.psaTicketId}.` };
  }

  let ticketId: number;
  try {
    ({ id: ticketId } = await client.createTicket(buildTicketRequest(finding)));
  } catch (error) {
    if (error instanceof ConnectWiseError) {
      // Nothing is written. The finding stays un-ticketed and retryable.
      return { produced: false, code: error.code, reason: error.message };
    }
    throw error;
  }

  await scoped.execute(sql`
    UPDATE scan_findings
    SET psa_ticket_id = ${String(ticketId)},
        last_psa_sync_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND id = ${finding.id} AND psa_ticket_id IS NULL
  `);

  return { produced: true, ticketId: String(ticketId) };
}
