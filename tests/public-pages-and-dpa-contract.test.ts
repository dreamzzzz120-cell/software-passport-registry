import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DPA_VERSION, dpaCanonicalText, dpaAllSections } from '../src/legal/dpa-document.ts';
import { SUBPROCESSORS } from '../src/legal/subprocessors.ts';
import { dpaDocumentSha256, signDpaExecution, verifyDpaSignature, type DpaExecutionRecord } from '../src/routes/public-pages.ts';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('the four public pages listed in the sitemap have real routes', () => {
  const app = read('src/App.tsx');
  const view = read('src/components/PublicTrustCenterView.tsx');

  it.each(['/security/', '/contact/', '/data-retention/', '/subprocessors/', '/dpa'])('%s is declared public and rendered', (route) => {
    const declared = app.match(/const PUBLIC_PATHS = new Set\(\[([^\]]+)\]\)/)![1];
    expect(declared).toContain(`'${route}'`);
    expect(app).toContain(`path === '${route}'`);
  });

  it('the contact form posts to a real endpoint and reports forwarding honestly', () => {
    expect(view).toContain("apiFetch('/api/public/contact'");
    expect(view).toContain('forwarded: data.forwarded === true');
    expect(read('server.ts')).toContain('createPublicPagesRouter()');
  });

  it('the subprocessor page reads live configuration instead of assuming it', () => {
    expect(view).toContain("apiFetch('/api/public/subprocessors')");
    for (const s of SUBPROCESSORS.filter((x) => x.optional)) expect(s.enabledBy, `${s.id} must name the variable that enables it`).toBeTruthy();
  });

  it('the retention page only promises what the worker does', () => {
    expect(read('src/workers/retention-worker.ts')).toContain('DELETE FROM contact_inquiries');
    expect(read('src/routes/auth.ts')).toContain('adminAuth.deleteUser(member.uid)');
  });
});

describe('Data Processing Agreement execution and signing', () => {
  const secret = 'test-document-signing-secret-at-least-32-chars';
  const record: DpaExecutionRecord = {
    id: 'dpa_0123456789abcdef0123456789abcdef', tenantId: 'tenant-a', documentVersion: DPA_VERSION, documentSha256: dpaDocumentSha256(),
    customerLegalName: 'Acme MSP Ltd.', signatoryName: 'Pat Example', signatoryTitle: 'Director', signatoryEmail: 'pat@example.com', executedAt: '2026-09-13T00:00:00.000Z',
  };

  it('the canonical text is deterministic and covers every section', () => {
    const text = dpaCanonicalText();
    expect(text).toBe(dpaCanonicalText());
    for (const section of dpaAllSections()) expect(text).toContain(section.heading);
    expect(text).toContain(`SPR DATA PROCESSING AGREEMENT ${DPA_VERSION}`);
    expect(dpaDocumentSha256()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signatures verify and any altered field fails', () => {
    const signature = signDpaExecution(record, secret);
    expect(verifyDpaSignature(record, signature, secret)).toBe(true);
    expect(verifyDpaSignature({ ...record, customerLegalName: 'Someone Else' }, signature, secret)).toBe(false);
    expect(verifyDpaSignature({ ...record, executedAt: '2026-09-14T00:00:00.000Z' }, signature, secret)).toBe(false);
    expect(verifyDpaSignature(record, signature, 'a-different-secret-that-is-also-32-chars')).toBe(false);
    expect(verifyDpaSignature(record, 'not-hex', secret)).toBe(false);
  });

  it('the annex lists the same subprocessors as the public page', () => {
    const annex = dpaAllSections().find((s) => s.heading.startsWith('Annex 3'))!;
    for (const s of SUBPROCESSORS) expect(annex.bullets!.some((b) => b.includes(s.legalEntity))).toBe(true);
  });

  it('execution is Owner-only and refuses to run unsigned', () => {
    const routes = read('src/routes/public-pages.ts');
    expect(routes).toContain("router.post('/organization/dpa/execute', requireAuth, requireRole('Owner'), rateLimiter");
    expect(routes).toContain("'DPA_SIGNING_NOT_CONFIGURED'");
  });
});

describe('orphaned developer tables', () => {
  it('are dropped by a reviewed script with a non-empty guard, never by a migration, and schema.ts says so', () => {
    const script = read('scripts/drop-orphan-developer-tables.ts');
    for (const t of ['work_sessions', 'snippets', 'tasks', 'projects', 'app_users']) expect(script).toContain(`'${t}'`);
    expect(script).toContain('holds');
    expect(read('migrations/0084_public_pages_dpa_and_orphan_cleanup.sql')).not.toMatch(/DROP TABLE/i);
    expect(read('src/db/schema.ts')).toContain('scripts/drop-orphan-developer-tables.ts');
    expect(read('src/db/schema.ts')).not.toContain('dropped in migration 0080');
  });
});
