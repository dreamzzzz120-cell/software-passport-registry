import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('public connect/share-token security contracts', () => {
  it('requires privileged tenant roles to mint Passport and report share tokens', () => {
    const source = read('src/routes/public-connect.ts');
    expect(source).toContain("router.post('/public/v1/passports/:id/token', requireAuth, requireRole(['Owner', 'Admin', 'Operator'])");
    expect(source).toContain("router.post('/public/v1/reports/:id/token', requireAuth, requireRole(['Owner', 'Admin', 'Operator'])");
  });

  it('binds share-token issuance to the authenticated tenant', () => {
    const source = read('src/routes/public-connect.ts');
    expect(source).toContain('WHERE id=${passportId} AND tenant_id=${req.user!.tenantId} LIMIT 1');
  });

  it('uses distinct token kinds for Passport and report bearer links', () => {
    const source = read('src/routes/public-connect.ts');
    expect(source).toContain("kind: 'report'");
    expect(source).toContain("payload.kind !== 'report'");
  });

  it('requires a signed token and matching passport id before public disclosure', () => {
    const source = read('src/routes/public-connect.ts');
    expect(source).toContain('verifyPublicPassportToken(req.params.token, req.params.id)');
    expect(source).toContain('verifyPublicReportToken(req.params.token, req.params.id)');
    expect(source).toContain('payload.passportId !== passportId');
  });

  it('re-checks tenant ownership before serving public Passport/report data', () => {
    const source = read('src/routes/public-connect.ts');
    expect(source).toContain('WHERE id=${req.params.id} AND tenant_id=${payload.tenantId} LIMIT 1');
    expect(source).toContain('const scopedDb = await attachTenantScope(payload.tenantId, res);');
  });

  it('does not leave the unsigned legacy Passport endpoint active', () => {
    const source = read('src/routes/public-connect.ts');
    expect(source).toContain("router.get('/public/v1/passports/:id/trust', async (_req, res) => res.status(410)");
  });
});
