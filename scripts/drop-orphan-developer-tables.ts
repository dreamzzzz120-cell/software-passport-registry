/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Drops the five orphaned developer-productivity tables (app_users, projects,
 * tasks, snippets, work_sessions) that migration 0000 created from an
 * unrelated template and no code path has ever used.
 *
 * This is a script, not a migration, on purpose: the production release gate
 * rejects DROP TABLE inside migrations/ so that destructive changes get an
 * explicit, reviewed run. It refuses to drop a table that holds any row.
 *
 * Usage (inside the running app container, where the database hostname
 * resolves; the script is bundled into dist/ by npm run build):
 *   railway ssh --service spr-app-staging --environment production \
 *     -- node dist/drop-orphan-developer-tables.cjs
 *
 * Pass --dry-run to report row counts without dropping anything.
 */
import { pool } from '../src/db/index.ts';

// Children first: projects/tasks/snippets/work_sessions reference app_users.
const TABLES = ['work_sessions', 'snippets', 'tasks', 'projects', 'app_users'] as const;
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const client = await pool.connect();
  try {
    const counts: Record<string, number | null> = {};
    for (const table of TABLES) {
      const exists = (await client.query('SELECT to_regclass($1) AS oid', [`public.${table}`])).rows[0]?.oid;
      if (!exists) { counts[table] = null; continue; }
      counts[table] = Number((await client.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
    }
    console.log('row counts:', counts);
    const populated = TABLES.filter((t) => (counts[t] ?? 0) > 0);
    if (populated.length) throw new Error(`refusing to drop: ${populated.join(', ')} holds rows and is therefore not orphaned`);
    if (dryRun) { console.log('dry run: nothing dropped'); return; }
    await client.query('BEGIN');
    for (const table of TABLES) {
      if (counts[table] === null) continue;
      await client.query(`DROP TABLE "${table}"`);
      console.log('dropped', table);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
