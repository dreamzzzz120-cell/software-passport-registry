/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { sql } from 'drizzle-orm';
import { db } from './index.ts';

type TenantTable = { table_name: string };
type TenantEdge = { child_table: string; parent_table: string };

function quoteIdentifier(identifier: string) {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

function orderTenantTables(tables: string[], edges: TenantEdge[]) {
  const tableSet = new Set(tables);
  const children = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const table of tables) {
    children.set(table, new Set());
    indegree.set(table, 0);
  }
  for (const edge of edges) {
    if (!tableSet.has(edge.child_table) || !tableSet.has(edge.parent_table) || edge.child_table === edge.parent_table) continue;
    const parents = children.get(edge.child_table)!;
    if (!parents.has(edge.parent_table)) {
      parents.add(edge.parent_table);
      indegree.set(edge.parent_table, (indegree.get(edge.parent_table) || 0) + 1);
    }
  }

  const queue = tables.filter(table => indegree.get(table) === 0).sort();
  const ordered: string[] = [];
  while (queue.length) {
    const table = queue.shift()!;
    ordered.push(table);
    for (const parent of children.get(table) || []) {
      const next = (indegree.get(parent) || 0) - 1;
      indegree.set(parent, next);
      if (next === 0) queue.push(parent);
    }
    queue.sort();
  }

  if (ordered.length !== tables.length) {
    throw new Error('Tenant offboarding detected a foreign-key cycle among tenant-owned tables');
  }
  return ordered;
}

/**
 * Atomically purges all tenant-owned data.
 * PostgreSQL metadata discovers every public table carrying tenant_id; FK
 * relationships are topologically ordered so children are removed first.
 */
export async function offboardTenantData(tenantId: string) {
  if (!tenantId || tenantId.length > 256) throw new Error('Invalid tenant ID');

  return db.transaction(async (tx) => {
    console.log(`[Tenant Lifecycle Manager] Purging all database records for tenant: ${tenantId}...`);

    const tablesResult = await tx.execute(sql.raw(
      "SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name",
    ));
    const tables = ((tablesResult as any).rows || []).map((row: TenantTable) => row.table_name);

    const edgesResult = await tx.execute(sql.raw(
      "SELECT DISTINCT child_kcu.table_name AS child_table, parent_kcu.table_name AS parent_table FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage child_kcu ON child_kcu.constraint_schema = tc.constraint_schema AND child_kcu.constraint_name = tc.constraint_name AND child_kcu.table_name = tc.table_name JOIN information_schema.constraint_column_usage parent_kcu ON parent_kcu.constraint_schema = tc.constraint_schema AND parent_kcu.constraint_name = tc.constraint_name WHERE tc.constraint_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY' AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = child_kcu.table_name AND c.column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = parent_kcu.table_name AND c.column_name = 'tenant_id')",
    ));
    const edges = ((edgesResult as any).rows || []) as TenantEdge[];
    const orderedTables = orderTenantTables(tables, edges);

    for (const table of orderedTables) {
      // Table names are safe to inline (they came from information_schema, not
      // user input); the tenant ID is a real bind parameter rather than a
      // hand-escaped string literal.
      await tx.execute(sql`DELETE FROM ${sql.raw(quoteIdentifier(table))} WHERE tenant_id = ${tenantId}`);
    }

    console.log(`[Tenant Lifecycle Manager] Offboarding completed atomically for ${tenantId}. Tables purged: ${orderedTables.length}.`);
    return true;
  }).catch((error) => {
    console.error(`[Tenant Lifecycle Manager Error] Tenant ${tenantId} purge rolled back:`, error);
    throw new Error('Tenant offboarding database purge operation failed.');
  });
}
