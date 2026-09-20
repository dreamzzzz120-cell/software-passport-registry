/**
 * Deletes every row a workspace (tenant) owns, in one database transaction.
 *
 * SPR has no fixed list of "tenant tables": 118 migrations have added them
 * over time and more will follow. Instead of a hand-maintained list that
 * silently goes stale, the set is read from information_schema at run time:
 * every public table with a tenant_id column. Foreign keys between those
 * tables are not all ON DELETE CASCADE, so deletion runs in passes: each
 * table is deleted inside its own savepoint, a table whose delete is refused
 * by a foreign key is rolled back to that savepoint and retried on the next
 * pass once its dependants are gone. A pass that makes no progress means a
 * cycle or a reference from outside the tenant set; the caller's transaction
 * is then rolled back, so a workspace is either deleted whole or not at all.
 *
 * The caller owns the transaction (BEGIN / COMMIT / ROLLBACK) and, when the
 * connection runs as the RLS runtime role, must have set app.tenant_id so
 * row-level security lets the deletes see the rows.
 */
import type { Queryable } from '../scanners/scan-ledger.ts';

export interface WorkspaceDeletionResult {
  /** Rows deleted per table, only tables where at least one row was removed. */
  deleted: Record<string, number>;
  /** Tables examined (every public table with a tenant_id column). */
  tablesExamined: number;
  passes: number;
}

export class WorkspaceDeletionBlocked extends Error {
  constructor(public readonly remaining: { table: string; reason: string }[]) {
    super(`Workspace deletion blocked: ${remaining.map((r) => `${r.table} (${r.reason})`).join('; ')}`);
    this.name = 'WorkspaceDeletionBlocked';
  }
}

export async function listTenantTables(db: Queryable): Promise<string[]> {
  const result = await db.query(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return result.rows.map((row: any) => String(row.table_name));
}

function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table name from information_schema: ${name}`);
  return `"${name}"`;
}

/** Rows per table the tenant currently owns; only tables with at least one row. */
export async function countTenantRows(db: Queryable, tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await listTenantTables(db)) {
    const result = await db.query(`SELECT COUNT(*)::int AS n FROM ${quoteIdentifier(table)} WHERE tenant_id = $1`, [tenantId]);
    const n = Number(result.rows[0]?.n ?? 0);
    if (n > 0) counts[table] = n;
  }
  return counts;
}

/**
 * @param expected Row counts taken beforehand on a connection that bypasses
 *   row-level security. When the deleting connection is the RLS runtime role,
 *   a table whose policy hides the tenant's rows would report a smaller
 *   delete count than really exists; that is treated as blocked, so a policy
 *   gap can never turn into a silently partial deletion.
 */
export async function deleteWorkspaceRows(db: Queryable, tenantId: string, expected?: Record<string, number>): Promise<WorkspaceDeletionResult> {
  if (!tenantId || tenantId.length > 256) throw new Error('A tenant id is required');
  const tables = await listTenantTables(db);
  // Declares, for this transaction only, which workspace is being deleted.
  // The append-only audit tables (login_history, trust_observations, ...)
  // reject every DELETE except rows of exactly this tenant while this is set
  // (migration 0110); nothing else in SPR sets it.
  await db.query("SELECT set_config('app.workspace_deletion', $1, true)", [tenantId]);
  const deleted: Record<string, number> = {};
  // agent_logs carries no tenant_id (migration 0000), only job_id, so the
  // column-based discovery never reaches it and job log lines (repository
  // names, file paths) outlived the workspace. Remove them by job id before
  // the tenant's agent_jobs rows go (review finding, 2026-09-20).
  {
    const logs = await db.query(`DELETE FROM agent_logs WHERE job_id IN (SELECT id FROM agent_jobs WHERE tenant_id = $1)`, [tenantId]);
    const count = Number(logs.rowCount ?? 0);
    if (count > 0) deleted.agent_logs = count;
  }
  let remaining = tables.map((table) => ({ table, reason: '' }));
  let passes = 0;
  let savepointSeq = 0;
  while (remaining.length > 0) {
    passes += 1;
    const next: { table: string; reason: string }[] = [];
    for (const { table } of remaining) {
      const savepoint = `spr_wd_${++savepointSeq}`;
      await db.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await db.query(`DELETE FROM ${quoteIdentifier(table)} WHERE tenant_id = $1`, [tenantId]);
        await db.query(`RELEASE SAVEPOINT ${savepoint}`);
        const count = Number(result.rowCount ?? 0);
        if (count > 0) deleted[table] = count;
      } catch (error) {
        await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        next.push({ table, reason: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : String(error) });
      }
    }
    if (next.length === remaining.length) throw new WorkspaceDeletionBlocked(next);
    remaining = next;
  }
  // Verify, inside the same transaction, that nothing of the tenant is left.
  // A delete that a policy or trigger quietly turned into a no-op would
  // otherwise be reported as success; here it aborts the whole operation.
  const leftover: { table: string; reason: string }[] = [];
  for (const table of tables) {
    const result = await db.query(`SELECT COUNT(*)::int AS n FROM ${quoteIdentifier(table)} WHERE tenant_id = $1`, [tenantId]);
    const n = Number(result.rows[0]?.n ?? 0);
    if (n > 0) leftover.push({ table, reason: `${n} row(s) remain after delete` });
  }
  if (expected) {
    for (const [table, n] of Object.entries(expected)) {
      const removed = deleted[table] ?? 0;
      if (removed < n) leftover.push({ table, reason: `${n} row(s) exist but only ${removed} were visible to delete` });
    }
  }
  if (leftover.length > 0) throw new WorkspaceDeletionBlocked(leftover);
  return { deleted, tablesExamined: tables.length, passes };
}
