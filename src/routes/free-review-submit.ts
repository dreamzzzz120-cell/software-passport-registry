/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../middleware/tenant-scope.ts';

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
): Promise<{ passportId: string; repositoryJobId: string; securityJobId: string }> {
  const { owner, repository, ipHash } = input;
  // null, not 'main': the worker resolves the repository's real default branch.
  const requestedRef = input.ref ?? null;
  const passportId = id('passport_free');
  const existingConnection = (await scopedDb.execute(sql`SELECT id FROM repository_connections WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`) as any).rows?.[0];
  const connectionId = existingConnection?.id || id('repo');
  if (!existingConnection) await scopedDb.execute(sql`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES (${connectionId},${FREE_REVIEW_TENANT_ID},'github','public-github','Free Review public GitHub acquisition','public','Active')`);
  const repositoryJobId = id('job');
  const securityJobId = id('job');
  await scopedDb.execute(sql`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES (${repositoryJobId},${FREE_REVIEW_TENANT_ID},'repository-scanner',${passportId},'repository_scan','Pending',0,NOW(),NOW(),NOW()),(${securityJobId},${FREE_REVIEW_TENANT_ID},'security-scanner',${passportId},'repository_security_scan','Pending',0,NOW(),NOW(),NOW())`);
  await scopedDb.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${repositoryJobId},${FREE_REVIEW_TENANT_ID},${connectionId},'github',${owner},${repository},${requestedRef},'',NOW())`);
  await scopedDb.execute(sql`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES (${id('source')},${securityJobId},${FREE_REVIEW_TENANT_ID},${connectionId},'github',${owner},${repository},${requestedRef},'',NOW())`);
  await scopedDb.execute(sql`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES (${repositoryJobId},'repository-scanner','Queued Free Review GitHub acquisition + Syft SBOM + OSV dependency scan.','Info'),(${securityJobId},'security-scanner','Queued Free Review secret, IaC/configuration, license and OSV scan.','Info')`);
  await scopedDb.execute(sql`INSERT INTO free_review_submissions (id,tenant_id,passport_id,repository_owner,repository_name,ip_hash,status) VALUES (${id('freereview')},${FREE_REVIEW_TENANT_ID},${passportId},${owner},${repository},${ipHash},'Pending')`);
  return { passportId, repositoryJobId, securityJobId };
}
