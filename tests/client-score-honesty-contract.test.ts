import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// clients.trust_score and clients.compliance_progress are NOT NULL integer
// columns that default to 0, and nothing in this codebase ever computes or
// writes either one to anything else, for any client, regardless of how much
// software/passport evidence that client has. A previous version of the
// client-directory normalization only converted 0 -> 'Not assessed' for a
// client with zero registered software, on the (false) assumption that a
// client WITH software would have a real computed score -- so a client with
// real registered inventory still showed a fabricated "0/100 Trust Score".
describe('client trust score / compliance progress is never silently fabricated as 0', () => {
  it('normalizes both fields unconditionally -- not gated on passport/inventory count', () => {
    const s = read('src/utils/apiClient.ts');
    expect(s).not.toContain('isUnassessed');
    expect(s).not.toContain('passportCount === 0');
    expect(s).toContain("if (Number(next.trustScore) === 0) {");
    expect(s).toContain("next.trustScore = 'Not assessed';");
    expect(s).toContain("if (Number(next.complianceProgress) === 0) {");
    expect(s).toContain("next.complianceProgress = 'Not assessed';");
  });

  it('the Client type reflects that these fields can be the honest string, not just a number', () => {
    const s = read('src/types.ts');
    expect(s).toContain("trustScore: number | 'Not assessed';");
    expect(s).toContain("complianceProgress: number | 'Not assessed';");
  });

  it('ClientsView never concatenates a raw suffix onto a non-numeric score (which would render as e.g. "Not assessed/100")', () => {
    const s = read('src/components/ClientsView.tsx');
    expect(s).toContain("typeof c.trustScore === 'number'");
    expect(s).toContain("typeof c.complianceProgress === 'number'");
    expect(s).toContain("typeof client.complianceProgress === 'number'");
  });

  it('pdfGenerator display helpers accept the honest string value from a client record', () => {
    const s = read('src/utils/pdfGenerator.ts');
    expect(s).toContain("export function scoreDisplay(score: number | 'Not assessed' | null | undefined): string {");
    expect(s).toContain("export function assessmentDisplay(progress: number | 'Not assessed' | null | undefined): string {");
  });
});
