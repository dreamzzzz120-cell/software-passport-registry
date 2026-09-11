/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seeds the public software registry with real Free Reviews of public GitHub
 * repositories. Each line of the input file is "owner/repository". Every
 * review goes through the exact enqueueFreeReview() path a visitor's review
 * uses, so the pages under /software are built from genuinely observed data.
 *
 * Usage (against production, via the Railway CLI so the DB URL is injected):
 *   railway run --service spr-app-staging --environment production \
 *     npx tsx scripts/seed-software-registry.ts scratch/seed-repos.txt
 *
 * Repositories that already have a completed review are skipped. The worker
 * drains the queue at its own pace; this script only enqueues.
 */
import fs from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { appPool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { enqueueFreeReview, FREE_REVIEW_TENANT_ID } from '../src/routes/free-review-submit.ts';

const file = process.argv[2];
if (!file) { console.error('usage: seed-software-registry.ts <repos.txt>'); process.exit(2); }
const repos = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.split('|')[0].trim()).filter((l) => /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(l));
if (repos.length === 0) { console.error('no valid owner/repository lines'); process.exit(2); }

const client = await appPool.connect();
let enqueued = 0, skipped = 0;
try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [FREE_REVIEW_TENANT_ID]);
  const db = drizzle(client, { schema });
  for (const full of repos) {
    const [owner, repository] = full.split('/');
    const done = (await db.execute(sql`
      SELECT 1 FROM agent_jobs j JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
      WHERE j.tenant_id = ${FREE_REVIEW_TENANT_ID} AND j.job_type = 'repository_scan' AND j.status IN ('Completed', 'Pending', 'Running')
        AND lower(s.repository_owner) = ${owner.toLowerCase()} AND lower(s.repository_name) = ${repository.toLowerCase()} LIMIT 1
    `) as any).rows?.length;
    if (done) { skipped += 1; continue; }
    const result = await enqueueFreeReview(db as any, { owner, repository, ref: null, ipHash: 'registry-seed' });
    enqueued += 1;
    console.log('enqueued', full, result.passportId);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await appPool.end().catch(() => undefined);
}
console.log(`done: ${enqueued} enqueued, ${skipped} already reviewed or in progress`);
