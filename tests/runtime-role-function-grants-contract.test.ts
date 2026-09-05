import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'migrations');
const sql = fs.readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
  .join('\n')
  .replace(/--[^\n]*/g, '');

const grantsTo = (role: string) => new Set(
  [...sql.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION\\s+([a-z_]+)\\s*\\(\\)\\s+TO\\s+${role}`, 'gi'))]
    .map((match) => match[1].toLowerCase()));

// Production, seven days: four scan jobs died with
//   permission denied for function spr_current_user_role
// and were dead-lettered after three identical retries. Migration 0065 put that
// function inside the RLS policy on public.users, revoked EXECUTE from PUBLIC,
// and granted it back to spr_app_runtime only -- so any worker query that had to
// evaluate the policy failed outright.
//
// A function reachable from an RLS policy has to be executable by every role
// that reads the table, not only by the API's role. Granting EXECUTE does not
// widen visibility: spr_current_user_role() reads app.user_id from the session
// and a worker sets none, so it returns NULL and the policy's privileged branch
// stays false. The grant lets the predicate be evaluated instead of erroring.
describe('both runtime roles can execute the functions their policies depend on', () => {
  const appGrants = grantsTo('spr_app_runtime');
  const workerGrants = grantsTo('spr_worker_runtime');

  it('finds the grants at all', () => {
    expect(appGrants.size).toBeGreaterThan(0);
  });

  it('grants every app-runtime function to the worker runtime too', () => {
    const missing = [...appGrants].filter((fn) => !workerGrants.has(fn)).sort();
    expect(
      missing,
      `functions the API role may execute but the worker role may not -- a worker query that evaluates a policy calling one of these fails with "permission denied for function": ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps spr_current_user_role executable by both, since the users policy calls it', () => {
    expect(sql).toMatch(/spr_current_user_role\(\)\s+IN\s+\('Owner', 'Admin', 'Operator'\)/);
    expect(appGrants.has('spr_current_user_role')).toBe(true);
    expect(workerGrants.has('spr_current_user_role')).toBe(true);
  });

  it('still keeps the function off PUBLIC', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION spr_current_user_role() FROM PUBLIC;');
  });
});
