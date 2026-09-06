import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// VendorsView.tsx has existed as a fully-built UI since earlier this session
// (search/filter/sort, drilldown, audit ledger) but was wired to nothing --
// App.tsx's vendors state was permanently EMPTY_VENDORS, and its audit
// attestation handler only ever mutated local React state, silently lost on
// refresh (that bug was fixed for the fabricated sub-metrics in an earlier
// commit; the missing persistence layer itself was left for this pass).
describe('vendors table and its audit ledger', () => {
  it('vendors is tenant-scoped with RLS, matching every other tenant table', () => {
    const migration = read('migrations/0035_vendor_risk.sql');
    expect(migration).toContain("CREATE POLICY spr_tenant_isolation ON vendors USING (tenant_id = current_setting(''app.tenant_id'', true))");
  });

  it('vendor_audits is an append-only ledger: the trigger rejects UPDATE/DELETE before touching NEW', () => {
    const migration = read('migrations/0035_vendor_risk.sql');
    const body = migration.slice(migration.indexOf('spr_enforce_vendor_audit_immutable'));
    const tgOpIndex = body.indexOf("TG_OP = 'UPDATE' OR TG_OP = 'DELETE'");
    const firstNewDereference = body.indexOf('NEW.vendor_id');
    expect(tgOpIndex).toBeGreaterThan(-1);
    expect(firstNewDereference).toBeGreaterThan(-1);
    expect(tgOpIndex).toBeLessThan(firstNewDereference);
  });

  it('grants spr_app_runtime and spr_worker_runtime access, so the RLS-scoped runtime connection can actually use these tables', () => {
    const migration = read('migrations/0035_vendor_risk.sql');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO spr_app_runtime');
    expect(migration).toContain('GRANT SELECT, INSERT ON vendor_audits TO spr_app_runtime');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO spr_worker_runtime');
  });
});

describe('vendors routes', () => {
  const source = () => read('src/routes/vendors.ts');

  it('excludes the Client role from reading vendor data (MSP-internal supply-chain data, not client-facing)', () => {
    const s = source();
    expect(s).toContain("const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];");
    expect(s).toContain("router.get('/', requireAuth, requireRole(NOT_CLIENT_ROLE)");
  });

  it('restricts vendor creation to Owner/Admin', () => {
    expect(source()).toContain("router.post('/', requireAuth, requireRole(['Owner', 'Admin'])");
  });

  it('lets Technician lodge audit attestations too, not just Owner/Admin', () => {
    expect(source()).toContain("router.post('/:id/audits', requireAuth, requireRole(['Owner', 'Admin', 'Technician'])");
  });

  it('recalculates reputation/trust/tier server-side from a real delta rule instead of trusting a client-supplied score', () => {
    const s = source();
    expect(s).not.toMatch(/reputationScore:\s*z\./);
    // 'Under Review' carries no score evidence and must not write a score at
    // all -- not even a same-value write, since that would convert an
    // unaudited vendor's null/unassessed score into a concrete number.
    expect(s).toContain("if (parsed.data.status === 'Under Review') {");
    expect(s).toContain("const delta = parsed.data.status === 'Passed' ? 3 : -10;");
    // A vendor with no prior scored audit (reputationScore null) must not
    // have delta applied to null directly -- that coerces to 0 in JS and
    // would produce a fabricated score with zero real evidence behind it.
    expect(s).toContain('const priorScore = vendor.reputationScore ?? 70;');
    expect(s).toContain('Math.min(100, Math.max(0, priorScore + delta))');
  });

  it('404s an audit lodged against a vendor id that does not belong to the caller\'s tenant', () => {
    expect(source()).toContain("if (!vendor) return res.status(404).json({ error: 'VENDOR_NOT_FOUND' });");
  });

  // A new vendor with zero audits previously defaulted to reputation_score
  // and overall_trust_score = 70 -- a specific, quantified "Fair" trust
  // rating asserted before a single piece of evidence existed for that
  // vendor. Fixed in migration 0071. This regression test statically
  // guards against either default silently returning.
  it('vendor score columns carry no fabricated default -- a vendor with zero audits has no score at all', () => {
    const schema = read('src/db/schema.ts');
    expect(schema).not.toContain("reputationScore: integer('reputation_score').notNull().default(70)");
    expect(schema).not.toContain("overallTrustScore: integer('overall_trust_score').notNull().default(70)");
    expect(schema).toContain("reputationScore: integer('reputation_score'),");
    expect(schema).toContain("overallTrustScore: integer('overall_trust_score'),");
    const migration = read('migrations/0071_vendor_score_no_fabricated_baseline.sql');
    expect(migration).toContain('ALTER TABLE vendors ALTER COLUMN reputation_score DROP DEFAULT');
    expect(migration).toContain('ALTER TABLE vendors ALTER COLUMN reputation_score DROP NOT NULL');
  });
});

describe('VendorsView is wired to the real API instead of local-only state', () => {
  const source = () => read('src/components/VendorsView.tsx');

  it('lodging an audit attestation calls the real endpoint', () => {
    expect(source()).toContain("apiFetch(`/api/vendors/${encodeURIComponent(selectedVendor.id)}/audits`, {");
  });

  it('creating a vendor calls the real endpoint', () => {
    expect(source()).toContain("apiFetch('/api/vendors', {");
  });

  it('gates vendor creation and audit lodging behind role, matching the backend requireRole checks', () => {
    const s = source();
    expect(s).toContain("const canManageVendors = role === 'Owner' || role === 'Admin';");
    expect(s).toContain("const canLodgeAudit = role === 'Owner' || role === 'Admin' || role === 'Technician';");
  });
});
