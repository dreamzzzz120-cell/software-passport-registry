import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTENTIONALLY_DROPPED_TABLES } from '../scripts/intentionally-dropped-tables';

const root = process.cwd();
const migrationsDir = join(root, 'migrations');
// CREATE TABLE [IF NOT EXISTS] [public.]<name>, quoted or bare -- the same
// shape the migrator's drift audit parses. Built with a regex literal so no
// string-escaping layer can silently turn "\s" into "s".
const createTableRe = (table: string) => new RegExp(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?/.source + table + /"?(?![a-z0-9_])/.source, 'i');
const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');

describe('intentionally dropped orphan tables', () => {
  it('the re-creation matcher actually matches (guards against a broken escape)', () => {
    expect('CREATE TABLE IF NOT EXISTS app_users (').toMatch(createTableRe('app_users'));
    expect('create table public."tasks" (').toMatch(createTableRe('tasks'));
    expect('CREATE TABLE tasks_archive (').not.toMatch(createTableRe('tasks'));
  });

  it('names exactly the five template tables migration 0084 documents as orphaned', () => {
    expect([...INTENTIONALLY_DROPPED_TABLES].sort()).toEqual(['app_users', 'projects', 'snippets', 'tasks', 'work_sessions']);
    const m84 = readFileSync(join(migrationsDir, '0084_public_pages_dpa_and_orphan_cleanup.sql'), 'utf8');
    for (const t of INTENTIONALLY_DROPPED_TABLES) expect(m84).toContain(t);
  });

  it('no migration after 0000 re-creates them (0109 did, and is now a no-op that keeps the sequence contiguous)', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.startsWith('0000')).sort();
    for (const f of files) {
      const sql = stripComments(readFileSync(join(migrationsDir, f), 'utf8'));
      for (const t of INTENTIONALLY_DROPPED_TABLES) expect(sql, `${f} re-creates ${t}`).not.toMatch(createTableRe(t));
    }
    const m109 = files.find((f) => f.startsWith('0109'));
    expect(m109).toBeDefined();
    expect(stripComments(readFileSync(join(migrationsDir, m109!), 'utf8')).trim()).toBe('SELECT 1;');
  });

  it('the drift audit excludes them and reports them if they come back; the drop script uses the same list', () => {
    const migrate = readFileSync(join(root, 'scripts/migrate.ts'), 'utf8');
    expect(migrate).toContain("import { INTENTIONALLY_DROPPED_TABLES } from './intentionally-dropped-tables.ts'");
    expect(migrate).toContain('!actual.has(table) && !intentionallyDropped.has(table)');
    expect(migrate).toContain('intentionally dropped table(s) exist again');
    const drop = readFileSync(join(root, 'scripts/drop-orphan-developer-tables.ts'), 'utf8');
    expect(drop).toContain("import { INTENTIONALLY_DROPPED_TABLES } from './intentionally-dropped-tables.ts'");
    expect(drop).not.toContain("from './migrate.ts'");
  });
});
