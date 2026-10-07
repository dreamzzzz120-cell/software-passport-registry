import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Q-LEGION persistence migration', () => {
  const sql = readFileSync(resolve(process.cwd(), 'migrations/0140_q_legion_shadow_swarm.sql'), 'utf8');

  it('creates tenant-scoped mission and receipt tables', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS q_legion_missions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS q_legion_mission_receipts');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('app.tenant_id', true)");
  });

  it('does not grant update or delete on receipts to runtime roles', () => {
    expect(sql).toContain('GRANT SELECT, INSERT ON q_legion_mission_receipts TO spr_app_runtime');
    expect(sql).toContain('GRANT SELECT, INSERT ON q_legion_mission_receipts TO spr_worker_runtime');
    expect(sql).not.toContain('GRANT SELECT, INSERT, UPDATE ON q_legion_mission_receipts');
  });
});
