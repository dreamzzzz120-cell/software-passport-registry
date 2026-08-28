import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// A real, previously-undiscovered defect class found live while verifying the
// new governance "Why" endpoint: Drizzle's `sql` tagged template does not
// bind a JS array as a single Postgres array parameter. `id = ANY(${arr})`
// compiles to `ANY(($2))` with the array's single element bound as a scalar,
// which Postgres rejects with "malformed array literal" the moment the query
// actually runs -- confirmed live against production for both the new
// src/routes/governance.ts why-endpoint and the pre-existing, previously
// untested verifyRemediation() in src/trust/trust-loop.ts (which has three
// occurrences of the same pattern, meaning remediation verification against
// real evidence has never actually completed successfully in production).
// The correct Drizzle idiom is `id IN ${arr}` (no manual parentheses --
// Drizzle adds its own, and doubling them produces a row-constructor instead
// of a list, which is a second, related failure mode also confirmed live).
describe('Drizzle sql-tag array binding: use "IN ${array}", never "= ANY(${array})" or "IN (${array})"', () => {
  it('src/routes/governance.ts evidenceChain query uses the correct IN pattern', () => {
    const s = read('src/routes/governance.ts');
    expect(s).toContain('FROM evidence_ledger WHERE tenant_id = ${tenantId} AND id IN ${evidenceIds}');
    expect(s).not.toMatch(/id\s*=\s*ANY\(\$\{evidenceIds\}\)/);
    expect(s).not.toContain('id IN (${evidenceIds})');
  });

  it('src/trust/trust-loop.ts verifyRemediation uses the correct IN pattern at all three call sites', () => {
    const s = read('src/trust/trust-loop.ts');
    expect(s).toContain('AND id IN ${evidenceIds}');
    expect(s).toContain('AND id IN ${observationIds}');
    expect(s).toContain('AND id IN ${priorEvidenceIds}');
    expect(s).not.toMatch(/id\s*=\s*ANY\(\$\{(evidenceIds|observationIds|priorEvidenceIds)\}\)/);
  });

  it('no remaining "= ANY(${...})" array-parameter pattern exists anywhere in src/, the exact shape that produces a malformed-array-literal error at runtime', () => {
    const files = ['src/routes/governance.ts', 'src/trust/trust-loop.ts', 'src/routes/vendors.ts', 'src/routes/questionnaires.ts', 'src/routes/savings.ts', 'src/routes/monitoring.ts'];
    for (const f of files) {
      const s = read(f);
      expect(s, `${f} still has the ANY(\${...}) bug pattern`).not.toMatch(/=\s*ANY\(\$\{[a-zA-Z]+\}\)/);
    }
  });
});
