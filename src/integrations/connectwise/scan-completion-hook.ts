/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The bridge from a completed scan to ConnectWise tickets.
//
// Two decisions here are product decisions as much as engineering ones, and
// both exist to stop the integration being switched off in its first week.
//
//  * NOT every finding becomes a ticket. A single real scan of expressjs/express
//    produced fourteen findings -- thirteen of them medium "licence not
//    observed". Filing fourteen tickets from one repository, across a portfolio
//    of client repositories, buries a service board and trains technicians to
//    close SPR tickets unread, which destroys the value of the ones that matter.
//    The default threshold is high, so that scan produces exactly one ticket:
//    the secret.
//
//  * There is a hard cap per scan. A pathological repository must not be able to
//    open an unbounded number of tickets in someone's PSA.
//
// Both are arguments with defaults, so an operator who wants everything ticketed
// can have it, deliberately, rather than by accident.

import { ConnectWiseClient } from './client.ts';
import { produceTicketForFinding, type ProduceOutcome, type TicketableFinding } from './outbound.ts';
import type { ConnectWiseCredentials } from './types.ts';

/** Minimal query surface, so this works with the workers' raw pg pool. */
export type SqlRunner = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;

export const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0, informational: 0,
};

export const DEFAULT_MIN_SEVERITY = 'high';
export const DEFAULT_MAX_TICKETS_PER_SCAN = 10;

export function meetsThreshold(severity: string, minSeverity: string): boolean {
  const rank = SEVERITY_RANK[String(severity).toLowerCase()];
  const floor = SEVERITY_RANK[String(minSeverity).toLowerCase()];
  if (rank === undefined || floor === undefined) return false;
  return rank >= floor;
}

/**
 * Findings from this job that warrant a ticket: newly detected, not already
 * ticketed, at or above the threshold. Ordered most severe first so the cap
 * spends itself on the findings that matter.
 */
export async function ticketableFindings(
  query: SqlRunner,
  options: { tenantId: string; jobId: string; minSeverity?: string; maxTickets?: number },
): Promise<TicketableFinding[]> {
  const minSeverity = options.minSeverity ?? DEFAULT_MIN_SEVERITY;
  const maxTickets = options.maxTickets ?? DEFAULT_MAX_TICKETS_PER_SCAN;
  const { rows } = await query(
    `SELECT id, severity, category, asset_id AS "assetId", psa_ticket_id AS "psaTicketId"
     FROM scan_findings
     WHERE tenant_id = $1 AND job_id = $2 AND state = 'detected' AND psa_ticket_id IS NULL`,
    [options.tenantId, options.jobId],
  );
  return (rows as TicketableFinding[])
    .filter((row) => meetsThreshold(String(row.severity), minSeverity))
    .sort((a, b) => (SEVERITY_RANK[String(b.severity).toLowerCase()] ?? 0) - (SEVERITY_RANK[String(a.severity).toLowerCase()] ?? 0))
    .slice(0, maxTickets);
}

const REQUIRED_CREDENTIAL_FIELDS = ['companyId', 'publicKey', 'privateKey', 'clientId', 'apiBaseUrl', 'defaultBoardId'] as const;

/**
 * The tenant's ConnectWise credentials, or null when the tenant has not
 * connected ConnectWise. Absence is the normal case and is not an error: most
 * tenants will never configure a PSA.
 *
 * A stored payload missing any field returns null too. Attempting a call with a
 * half-configured credential produces an authentication failure against the
 * customer's real PSA, which looks to them like SPR probing their account.
 */
export function credentialsFrom(payload: Record<string, unknown> | null | undefined): ConnectWiseCredentials | null {
  if (!payload) return null;
  const missing = REQUIRED_CREDENTIAL_FIELDS.filter((field) => !String(payload[field] ?? '').trim());
  if (missing.length > 0) return null;
  return {
    companyId: String(payload.companyId),
    publicKey: String(payload.publicKey),
    privateKey: String(payload.privateKey),
    clientId: String(payload.clientId),
    apiBaseUrl: String(payload.apiBaseUrl),
    defaultBoardId: String(payload.defaultBoardId),
  };
}

export interface ScanCompletionResult {
  attempted: number;
  produced: number;
  outcomes: ProduceOutcome[];
  skipped?: 'NO_CREDENTIALS' | 'NOTHING_TICKETABLE';
}

/**
 * Called when a scan job reaches its terminal success state.
 *
 * Never throws into the worker loop: a PSA that is down, misconfigured or slow
 * must not fail a scan that already succeeded and whose evidence is already
 * recorded. Every finding it could not ticket stays un-ticketed and retryable.
 */
export async function onScanCompleted(deps: {
  query: SqlRunner;
  tenantId: string;
  jobId: string;
  credentials: ConnectWiseCredentials | null;
  minSeverity?: string;
  maxTickets?: number;
  makeClient?: (credentials: ConnectWiseCredentials) => ConnectWiseClient;
}): Promise<ScanCompletionResult> {
  if (!deps.credentials) return { attempted: 0, produced: 0, outcomes: [], skipped: 'NO_CREDENTIALS' };

  const findings = await ticketableFindings(deps.query, {
    tenantId: deps.tenantId,
    jobId: deps.jobId,
    minSeverity: deps.minSeverity,
    maxTickets: deps.maxTickets,
  });
  if (findings.length === 0) return { attempted: 0, produced: 0, outcomes: [], skipped: 'NOTHING_TICKETABLE' };

  const client = (deps.makeClient ?? ((credentials) => new ConnectWiseClient(credentials)))(deps.credentials);
  // The stamp carries the tenant id and the IS NULL guard, so a concurrent
  // producer cannot overwrite a ticket id that another run already recorded.
  const stamp = async (findingId: string, ticketId: string) => {
    await deps.query(
      `UPDATE scan_findings
       SET psa_ticket_id = $3, last_psa_sync_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 AND psa_ticket_id IS NULL`,
      [deps.tenantId, findingId, ticketId],
    );
  };

  const outcomes: ProduceOutcome[] = [];
  for (const finding of findings) {
    try {
      outcomes.push(await produceTicketForFinding(stamp, finding, client));
    } catch (error) {
      outcomes.push({
        produced: false,
        code: 'CONNECTWISE_REQUEST_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { attempted: findings.length, produced: outcomes.filter((o) => o.produced).length, outcomes };
}
