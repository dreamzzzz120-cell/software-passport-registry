import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Two foundational defects found via live adversarial testing: both routes
// had never successfully completed for a real, common case, for as long as
// they've existed.
describe('POST /trust-loop/remediations no longer writes to the dead remediation_tasks table', () => {
  it('does not insert into remediation_tasks (its integrity trigger requires alert_id to reference the never-populated `alerts` table, so this insert unconditionally failed every time)', () => {
    const s = read('src/routes/trust-loop.ts');
    const routeStart = s.indexOf("router.post('/remediations',");
    const routeEnd = s.indexOf("router.patch('/remediations/:id'");
    const routeBody = s.slice(routeStart, routeEnd);
    expect(routeBody).not.toContain('INSERT INTO remediation_tasks');
  });

  it('still writes the real, actively-read trust_remediation_work_items row', () => {
    const s = read('src/routes/trust-loop.ts');
    expect(s).toContain('INSERT INTO trust_remediation_work_items');
  });
});

describe('PATCH /trust-loop/remediations/:id status-only update no longer 500s', () => {
  it('binds null instead of undefined for the unreachable ELSE branch when slaDueAt is omitted', () => {
    const s = read('src/routes/trust-loop.ts');
    expect(s).toContain('ELSE ${p.slaDueAt ?? null} END');
  });
});

describe('trust_report_snapshots allows a legitimately null score/confidence', () => {
  it('drops the NOT NULL constraint on score and confidence_basis_points, matching trust_observations', () => {
    const migration = read('migrations/0038_report_snapshot_null_score.sql');
    expect(migration).toContain('ALTER TABLE trust_report_snapshots ALTER COLUMN score DROP NOT NULL;');
    expect(migration).toContain('ALTER TABLE trust_report_snapshots ALTER COLUMN confidence_basis_points DROP NOT NULL;');
  });

  it('leaves completeness_basis_points NOT NULL (it is always a real, computable number, never legitimately absent)', () => {
    const migration = read('migrations/0038_report_snapshot_null_score.sql');
    expect(migration).not.toContain('completeness_basis_points DROP NOT NULL');
  });
});
