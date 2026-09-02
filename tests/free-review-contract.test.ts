import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Free Review contracts', () => {
  it('signs status tokens with a kind discriminator distinct from passport and report tokens', () => {
    const publicConnect = read('src/routes/public-connect.ts');
    expect(publicConnect).toContain('function signFreeReviewStatusToken');
    expect(publicConnect).toContain("kind: 'free_review_status'");
    expect(publicConnect).toContain('function verifyFreeReviewStatusToken');
    expect(publicConnect).toContain("payload.kind !== 'free_review_status'");
    const freeReview = read('src/routes/free-review-legacy.ts');
    expect(freeReview).toContain('verifyFreeReviewStatusToken(req.params.token, passportId)');
  });

  it('is mounted without requireAuth in front of it, unlike the authenticated routers', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api', createFreeReviewRouter());");
    const freeReviewLine = server.indexOf("createFreeReviewRouter()");
    const surrounding = server.slice(Math.max(0, freeReviewLine - 120), freeReviewLine);
    expect(surrounding).not.toContain('requireAuth');
  });

  it('never pre-inserts a passports row -- the repository-scan worker creates it from acquired metadata', () => {
    const freeReview = read('src/routes/free-review-legacy.ts');
    expect(freeReview).not.toMatch(/INSERT INTO passports/);
    expect(freeReview).toContain("INSERT INTO agent_jobs");
    expect(freeReview).toContain("'repository_scan'");
    expect(freeReview).toContain("'repository_security_scan'");
  });

  it('scopes every query to the fixed system tenant, not a caller-supplied tenant', () => {
    const freeReview = read('src/routes/free-review-legacy.ts');
    expect(freeReview).toContain("export const FREE_REVIEW_TENANT_ID = 'tenant-free-review-system';");
    expect(freeReview).toContain('attachTenantScope(FREE_REVIEW_TENANT_ID, res)');
  });

  it('enforces a daily per-IP submission cap before creating a new scan job', () => {
    const freeReview = read('src/routes/free-review-legacy.ts');
    const capIndex = freeReview.indexOf('recentCount');
    expect(capIndex).toBeGreaterThan(-1);
    expect(freeReview.slice(capIndex, capIndex + 300)).toContain('DAILY_SUBMISSIONS_PER_IP');
    const jobInsertIndex = freeReview.indexOf('INSERT INTO agent_jobs');
    expect(capIndex).toBeLessThan(jobInsertIndex);
  });

  it('reads evidence directly and never calls publicTrustResponse, which would silently report UNKNOWN for every result', () => {
    const freeReview = read('src/routes/free-review-legacy.ts');
    expect(freeReview).not.toContain('publicTrustResponse(');
    expect(freeReview).not.toMatch(/import\s*\{[^}]*publicTrustResponse/);
    expect(freeReview).toContain('FROM evidence_items WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND asset_id=${passportId}');
    expect(freeReview).toContain('FROM scan_findings WHERE tenant_id=${FREE_REVIEW_TENANT_ID} AND asset_id=${passportId}');
  });

  it('routes both the submit and status endpoints through a path containing "/scan", guaranteeing the expensive rate-limit bucket regardless of ID format', () => {
    const freeReview = read('src/routes/free-review-legacy.ts');
    expect(freeReview).toContain("router.post('/free-review/scan'");
    expect(freeReview).toContain("router.get('/free-review/scan/:passportId/status/:token'");
  });

  it('keeps the new free-review table tenant-scoped with RLS and runtime grants', () => {
    const migration = read('migrations/0044_free_review_submissions.sql');
    expect(migration).toContain("CHECK (tenant_id = 'tenant-free-review-system')");
    expect(migration).toContain('ALTER TABLE free_review_submissions ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY spr_tenant_isolation ON free_review_submissions');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON free_review_submissions TO spr_app_runtime');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON free_review_submissions TO spr_worker_runtime');
  });
});
