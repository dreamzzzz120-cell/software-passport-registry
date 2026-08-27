import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('persistent white-label branding', () => {
  it('exposes real, tenant-scoped, role-gated read/write routes', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("router.get('/organization/branding', requireAuth,");
    expect(auth).toContain("router.put('/organization/branding', requireAuth, requireRole(['Owner', 'Admin'])");
    // Every query is scoped by the caller's own tenant, never a client-supplied id.
    expect(auth).toContain('WHERE tenant_id = ${req.user!.tenantId}');
    expect(auth).toContain('VALUES (${tenantId}');
  });

  it('validates brand color and logo shape server-side, not just in the UI', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain('brandColor must be a #rrggbb hex color');
    expect(auth).toContain('logoDataUrl must be a base64 image data URL');
  });

  it('persists via a real migration with row-level security, matching every other tenant-scoped table', () => {
    const migration = read('migrations/0030_tenant_branding.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS tenant_branding');
    expect(migration).toContain("ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain('spr_tenant_isolation');
  });

  it('ReportsView pre-fills the white-label export from saved branding instead of leaving it blank every time', () => {
    const reportsView = read('src/components/ReportsView.tsx');
    expect(reportsView).toContain("apiFetch('/api/organization/branding')");
    expect(reportsView).toContain('setMspName(data.companyName)');
  });

  it('SettingsView lets only Owner/Admin edit branding, matching the same canManageTeam gate as team management', () => {
    const settingsView = read('src/components/SettingsView.tsx');
    expect(settingsView).toContain("apiFetch('/api/organization/branding')");
    expect(settingsView).toContain('disabled={!canManageTeam}');
  });
});
