import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Q-LEGION attribution learning migration', () => {
  const sql = readFileSync(resolve(process.cwd(), 'migrations/0141_q_legion_attribution_learning.sql'), 'utf8');

  it('adds bounded strategy attribution to sent distribution messages', () => {
    expect(sql).toContain('q_legion_mission_id');
    expect(sql).toContain('q_legion_strategy_id');
    expect(sql).toContain('q_legion_strategy_probability');
    expect(sql).toContain('distribution_messages_q_legion_mission_fk');
  });

  it('adds checkout as a distinct observed pipeline stage', () => {
    expect(sql).toContain('checkout_at timestamp');
    expect(sql).toContain("'demo','checkout','pilot','customer'");
    expect(sql).toContain("'replied','demo','checkout','pilot','customer','lost'");
  });

  it('keeps strategy execution behind tenant-scoped settings', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS q_legion_settings');
    expect(sql).toContain('strategy_execution_enabled boolean');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('app.tenant_id', true)");
  });
});
