import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR reports center contracts', () => {
  it('scopes report history and snapshot lookups to the requesting tenant and passport', () => {
    const trustLoop = read('src/routes/trust-loop.ts');
    expect(trustLoop).toContain("router.get('/reports/:passportId/history'");
    expect(trustLoop).toContain('tenant_id=${tenantId} AND passport_id=${passportId}');
    expect(trustLoop).toContain("router.get('/reports/:passportId/history/:snapshotId'");
    expect(trustLoop).toContain('id=${req.params.snapshotId} AND tenant_id=${tenantId} AND passport_id=${req.params.passportId}');
  });

  it('differentiates SBOM and compliance report payloads instead of returning one shape for every report type', () => {
    const trustLoop = read('src/routes/trust-loop.ts');
    expect(trustLoop).toContain('function buildReportTypeExtras');
    expect(trustLoop).toContain("if (reportType === 'sbom')");
    expect(trustLoop).toContain("if (reportType === 'compliance')");
    expect(trustLoop).toContain('...buildReportTypeExtras(parsed.data, passport, findings)');
  });

  it('signs report share tokens with a kind discriminator distinct from passport verification tokens', () => {
    const publicConnect = read('src/routes/public-connect.ts');
    expect(publicConnect).toContain('function signPublicReportToken');
    expect(publicConnect).toContain("kind: 'report'");
    expect(publicConnect).toContain('function verifyPublicReportToken');
    expect(publicConnect).toContain("payload.kind !== 'report'");
    // The report route must verify with the report-specific function, not the
    // passport one, or a passport link could be replayed as a report link.
    expect(publicConnect).toContain("verifyPublicReportToken(req.params.token, req.params.id)");
  });

  it('gates report share-link minting to elevated roles and keeps the read side unauthenticated but tenant-scoped', () => {
    const publicConnect = read('src/routes/public-connect.ts');
    expect(publicConnect).toContain("router.post('/public/v1/reports/:id/token', requireAuth, requireRole(['Owner', 'Admin', 'Operator'])");
    expect(publicConnect).toContain("router.get('/public/v1/reports/:id/:token'");
    expect(publicConnect).toContain('attachTenantScope(payload.tenantId, res)');
    expect(publicConnect).toContain("tenant_id=${payload.tenantId}");
  });

  it('does not let shared report links cache in shared/public HTTP caches', () => {
    const publicConnect = read('src/routes/public-connect.ts');
    const shareHandlerStart = publicConnect.indexOf("router.get('/public/v1/reports/:id/:token'");
    const shareHandlerBody = publicConnect.slice(shareHandlerStart, shareHandlerStart + 800);
    expect(shareHandlerBody).toContain("cache-control', 'private, max-age=0, no-store'");
  });
});
