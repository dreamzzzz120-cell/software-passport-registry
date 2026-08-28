import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real production bug, found via live testing while cleaning up temporary
// monitoring test fixtures: spr_trust_observation_integrity's UPDATE/DELETE
// guard ran AFTER several checks that dereference NEW, which is NULL on a
// DELETE -- so every delete attempt raised the wrong error ("passport does
// not belong to tenant") instead of the intended TRUST_OBSERVATION_IMMUTABLE.
describe('trust_observations DELETE/UPDATE rejection reports the correct error', () => {
  it('checks TG_OP before dereferencing NEW anywhere else in the function', () => {
    const migration = read('migrations/0033_trust_observation_delete_error_ordering.sql');
    const body = migration.slice(migration.indexOf('BEGIN\n', migration.indexOf('$$')));
    const tgOpIndex = body.indexOf("TG_OP = 'UPDATE' OR TG_OP = 'DELETE'");
    const firstNewDereference = body.indexOf('NEW.passport_id');
    expect(tgOpIndex).toBeGreaterThan(-1);
    expect(firstNewDereference).toBeGreaterThan(-1);
    expect(tgOpIndex).toBeLessThan(firstNewDereference);
  });

  it('still rejects UPDATE and DELETE with the intended immutability error, unconditionally', () => {
    const migration = read('migrations/0033_trust_observation_delete_error_ordering.sql');
    expect(migration).toContain("RAISE EXCEPTION 'TRUST_OBSERVATION_IMMUTABLE';");
  });

  it('leaves every other integrity check (passport/client tenancy, version, chain) unchanged', () => {
    const migration = read('migrations/0033_trust_observation_delete_error_ordering.sql');
    expect(migration).toContain("RAISE EXCEPTION 'Trust observation passport does not belong to tenant';");
    expect(migration).toContain("RAISE EXCEPTION 'Trust observation client does not belong to tenant';");
    expect(migration).toContain("RAISE EXCEPTION 'Trust observation chain is invalid';");
  });
});
