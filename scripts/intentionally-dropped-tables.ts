/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Tables a migration created that were later removed on purpose. Migration
// 0000 came from an unrelated template and created five developer-productivity
// tables no code path has ever used; migration 0084 documents the decision and
// scripts/drop-orphan-developer-tables.ts dropped them on 2026-09-13 (the
// release gate forbids DROP TABLE inside migrations, so the drop is an explicit,
// reviewed run). Without this list the migrator's drift audit reported them as
// missing on every deploy, and on 2026-09-18 that report led to a migration
// (0109, since removed) that re-created them.
//
// Kept in its own module: migrate.ts runs its main() when it is the entry
// module, and esbuild bundles importers into one module, so importing
// migrate.ts from another script would run the migrator inside it.
export const INTENTIONALLY_DROPPED_TABLES = ['app_users', 'projects', 'tasks', 'snippets', 'work_sessions'] as const;
