import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Client notification visibility is enforced at the database boundary', () => {
  const migration = () => read('migrations/0075_client_notification_visibility_rls.sql');

  it('replaces tenant-only notification visibility with client-aware RLS', () => {
    const sql = migration();
    expect(sql).toContain('DROP POLICY IF EXISTS spr_tenant_isolation ON public.in_app_notifications;');
    expect(sql).toContain('CREATE POLICY spr_tenant_isolation ON public.in_app_notifications');
    expect(sql).toContain("spr_current_user_role() <> 'Client'");
    expect(sql).toContain('s.id = in_app_notifications.subscription_id');
    expect(sql).toContain('s.client_id = u.client_id');
    expect(sql).toContain("u.role = 'Client'");
    expect(sql).toContain("current_setting('app.user_id', true)");
  });

  it('keeps the existing tenant boundary in both USING and WITH CHECK', () => {
    const sql = migration();
    expect(sql.match(/tenant_id = current_setting\('app\.tenant_id', true\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
