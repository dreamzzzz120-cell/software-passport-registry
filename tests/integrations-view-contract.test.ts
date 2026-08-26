import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR integrations UI contracts', () => {
  it('drives Connect/Sync from the real live-integration endpoints instead of the removed dead /toggle and /sync routes', () => {
    const view = read('src/components/IntegrationsView.tsx');
    expect(view).toContain("apiFetch('/api/integrations-live/')");
    expect(view).toContain('/api/integrations-live/${encodeURIComponent(provider)}/credentials');
    expect(view).toContain('/api/integrations-live/${encodeURIComponent(provider)}/test');
    const app = read('src/App.tsx');
    expect(app).not.toContain('/api/integrations/${encodeURIComponent(id)}/toggle');
    expect(app).not.toContain('/api/integrations/${encodeURIComponent(id)}/sync');
  });

  it('routes GitHub to the real repository-scan flow instead of the generic credential adapter that explicitly rejects it', () => {
    const view = read('src/components/IntegrationsView.tsx');
    expect(view).toContain("isGithub ?");
    expect(view).toContain("onNavigateTab?.('/scans')");
  });

  it('adds first-party webhook management gated the same way as the rest of tenant administration', () => {
    const connect = read('src/routes/connect.ts');
    expect(connect).toContain("router.get('/v1/dashboard/webhooks', requireAuth, requireRole(['Owner', 'Admin'])");
    expect(connect).toContain("router.post('/v1/dashboard/webhooks', requireAuth, requireRole(['Owner', 'Admin'])");
    expect(connect).toContain("router.delete('/v1/dashboard/webhooks/:id', requireAuth, requireRole(['Owner', 'Admin'])");
  });

  it('keeps credential fields for each provider in the same set the real collector actually reads', () => {
    const fields = read('src/integrations/credentialFields.ts');
    const adapters = read('src/integrations/adapters.ts');
    // Spot-check a couple of providers whose adapters have unusual required fields.
    expect(fields).toContain("key: 'organization'");
    expect(adapters).toContain('credentials.organization');
    expect(fields).toContain("key: 'integrationCode'");
    expect(adapters).toContain('credentials.integrationCode');
  });
});
