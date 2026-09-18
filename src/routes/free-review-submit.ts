/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { enqueueRepositoryScan } from '../scanners/scan-submission.ts';

// The single way a Free Review gets queued. Used by the public
// POST /api/free-review/scan route and by scripts/seed-software-registry.ts,
// so a seeded review and a visitor's review are the same rows, the same jobs
// and the same workers -- never a second path that could produce a different
// kind of result.
export const FREE_REVIEW_TENANT_ID = 'tenant-free-review-system';

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }

export async function enqueueFreeReview(
  scopedDb: ScopedDb,
  input: { owner: string; repository: string; ref?: string | null; ipHash: string },
): Promise<{ passportId: string; repositoryJobId: string; securityJobId: string; scanRunId: string }> {
  const { owner, repository, ipHash } = input;
  // null, not 'main': the worker resolves the repository's real default branch.
  const requestedRef = input.ref ?? null;
  const passportId = id('passport_free');
  // Same ledger, same jobs, same inventory as an authenticated scan: a Free
  // Review is not a different kind of scan, only a differently-owned one.
  const submitted = await enqueueRepositoryScan(scopedDb, {
    tenantId: FREE_REVIEW_TENANT_ID, clientId: null, passportId, owner, repository, ref: requestedRef, subdirectory: '',
    triggeredBy: 'free-review', targetName: `${owner}/${repository}`, clientName: 'Free Review', scanType: 'Free Review repository scan',
    connectionLabel: 'Free Review public GitHub acquisition',
  });
  await scopedDb.execute(sql`INSERT INTO free_review_submissions (id,tenant_id,passport_id,repository_owner,repository_name,ip_hash,status) VALUES (${id('freereview')},${FREE_REVIEW_TENANT_ID},${passportId},${owner},${repository},${ipHash},'Pending')`);
  return { passportId, repositoryJobId: submitted.repositoryJobId, securityJobId: submitted.securityJobId, scanRunId: submitted.scanRunId };
}
