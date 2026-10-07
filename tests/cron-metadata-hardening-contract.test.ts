import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'migrations/0139_cron_metadata_private.sql'), 'utf8');

describe('pg_cron metadata hardening', () => {
  it('removes PUBLIC and Supabase client-role table privileges', () => {
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE cron.job FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM PUBLIC');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('FROM authenticated');
  });

  it('restricts pg_cron RLS policies to postgres', () => {
    expect(sql).toContain('ALTER POLICY cron_job_policy ON cron.job TO postgres');
    expect(sql).toContain('ALTER POLICY cron_job_run_details_policy ON cron.job_run_details TO postgres');
  });

  it('keeps postgres access and removes client schema usage', () => {
    expect(sql).toContain('GRANT SELECT ON TABLE cron.job TO postgres');
    expect(sql).toContain('GRANT USAGE ON SCHEMA cron TO postgres');
    expect(sql).toContain('REVOKE USAGE ON SCHEMA cron FROM PUBLIC');
  });
});
