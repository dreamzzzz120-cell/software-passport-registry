import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

// Observed live 2026-09-19 02:09Z on the first authenticated upload scan:
// the intake worker finished every engine, persisted the inventory, coverage,
// evidence and findings, then failed on its last statement with
//   new row for relation "intake_sessions" violates check constraint
//   "intake_sessions_status_check"
// because it wrote status='COMPLETED' and migration 0055 only allows
// OPEN / CLAIMED / CLOSED / EXPIRED. Every upload scan therefore ended
// "Failed" after three identical attempts. This test runs the real
// migrations and every status literal the source writes to that table.

let pg: PGlite;
const ROOT = path.resolve(__dirname, '..');

beforeAll(async () => {
  pg = new PGlite();
  const dir = path.join(ROOT, 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    try { await pg.exec(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch (error) { throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}, 120_000);

afterAll(async () => { await pg?.close(); });

function statusLiteralsWrittenTo(table: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full); } };
  walk(path.join(ROOT, 'src'));
  const found = new Set<string>();
  const update = new RegExp(String.raw`UPDATE\s+${table}\s+SET[^;` + '`' + String.raw`]*?\bstatus\s*=\s*'([A-Z_]+)'`, 'g');
  // INSERT value lists may contain calls such as NOW(); match to the closing
  // paren that precedes the end of the statement instead of the first one.
  const insert = new RegExp(String.raw`INSERT\s+INTO\s+${table}\s*\(([^)]*)\)\s*VALUES\s*\((.*?)\)\s*(?:ON\s+CONFLICT|RETURNING|` + '`' + String.raw`|;)`, 'gs');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(update)) found.add(match[1]);
    for (const match of source.matchAll(insert)) {
      const columns = match[1].split(',').map((c) => c.trim());
      const values = match[2].split(',').map((v) => v.trim());
      const index = columns.indexOf('status');
      const literal = index >= 0 ? values[index]?.match(/^'([A-Z_]+)'$/)?.[1] : undefined;
      if (literal) found.add(literal);
    }
  }
  return [...found].sort();
}

describe('intake_sessions.status literals written by the source', () => {
  it('are every one accepted by the CHECK constraint in the real schema', async () => {
    const literals = statusLiteralsWrittenTo('intake_sessions');
    expect(literals.length).toBeGreaterThan(0);
    for (const status of literals) {
      const id = `intake_status_${status.toLowerCase()}`;
      await pg.query(`INSERT INTO intake_sessions (id, tenant_id, status, expires_at) VALUES ($1, 'tenant-test', 'OPEN', NOW() + interval '1 day')`, [id]);
      await expect(pg.query(`UPDATE intake_sessions SET status=$2 WHERE id=$1 AND tenant_id='tenant-test'`, [id, status]), `status '${status}' must satisfy intake_sessions_status_check`).resolves.toBeTruthy();
    }
  });

  it('the worker closes the session with a value the schema accepts (regression for the 2026-09-19 failure)', async () => {
    const worker = fs.readFileSync(path.join(ROOT, 'src', 'workers', 'intake-scan-worker.ts'), 'utf8');
    expect(worker).not.toMatch(/UPDATE intake_sessions SET status='COMPLETED'/);
    expect(worker).toMatch(/UPDATE intake_sessions SET status='CLOSED' WHERE id=\$1 AND tenant_id=\$2/);
  });
});
