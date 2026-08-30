import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Release-audit finding: publicTrustResponse (the public Passport share link
// and the public report share link) used to compute its own `status`
// independently of src/lib/verification -- a second, looser evaluator whose
// VERIFIED bar required no independent third-party source at all. Reproduced
// live against production: for every passport the repository-scan pipeline
// actually produces (Free Review, POST /scans/repository), trust_findings/
// evidence_ledger/trust_observations are empty, since those tables belong to
// a separate continuous-monitoring subsystem -- so the public page could
// diverge from, or be laxer than, the one authoritative decision the rest of
// the product (GET /user/passports/:id/verification, Trust Room, MSP Command
// Center) actually computes for the same passport.
describe('the public Passport/report response uses the single authoritative evaluator, never a second one', () => {
  const source = () => read('src/routes/public-connect.ts');

  it('imports and calls the same adapter and evaluator every other verification surface uses', () => {
    const s = source();
    expect(s).toContain("import { adaptEvidenceForEvaluation } from '../lib/verification/evidenceAdapter.ts';");
    expect(s).toContain("import { evaluateVerification } from '../lib/verification/evaluateVerification.ts';");
    const start = s.indexOf('export async function publicTrustResponse');
    const body = s.slice(start, start + 3000);
    expect(body).toContain('adaptEvidenceForEvaluation({');
    expect(body).toContain('evaluateVerification({');
  });

  it('the returned status is the authoritative decision state, not a separately-computed value', () => {
    const s = source();
    expect(s).toContain('status: decision.state,');
    expect(s).toMatch(/^\s*decision,\s*$/m);
  });

  it('reads real evidence_items/scan_findings scoped to this passport\'s own tenant, matching the authenticated verification endpoint\'s query shape', () => {
    const s = source();
    const start = s.indexOf('export async function publicTrustResponse');
    const body = s.slice(start, start + 1500);
    expect(body).toContain('FROM evidence_items WHERE tenant_id=${passport.tenant_id} AND asset_id=${passport.id}');
    expect(body).toContain("FROM scan_findings WHERE tenant_id=${passport.tenant_id} AND asset_id=${passport.id} AND lower(status) NOT IN ('resolved','closed','verified')");
  });

  it('retains the legacy continuous-monitoring data as a separate, clearly-labeled field rather than deleting a subsystem that is not confirmed dead', () => {
    const s = source();
    expect(s).toContain('continuousMonitoring:');
    expect(s).toContain('FROM trust_findings');
    expect(s).toContain('FROM evidence_ledger');
    expect(s).toContain('FROM trust_observations');
  });
});
