import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// ScansView's batch-tag "Apply & Sync" action was wired to a prop
// (onBatchTagScans) that App.tsx never actually passed down -- selecting
// scans, typing a category, and clicking Apply cleared the selection as if
// it succeeded, but silently did nothing at all, with zero indication to
// the user. There was also no backend route for this at all.
describe('scan batch-tag is a real, working action', () => {
  it('POST /scans/batch-tag exists, is role-gated, and validates its input', () => {
    const s = read('src/routes/scans.ts');
    expect(s).toContain("router.post('/scans/batch-tag', requireRole(['Owner', 'Admin', 'Operator'])");
    expect(s).toContain('const parsed = batchTagSchema.safeParse(req.body);');
  });

  it('uses the correct Drizzle IN-list idiom (see tests/drizzle-array-in-clause-contract.test.ts) -- no manual parens, no ANY()', () => {
    const s = read('src/routes/scans.ts');
    expect(s).toContain('AND id IN ${scanIds}');
    expect(s).not.toContain('id IN (${scanIds})');
  });

  it('ScansView calls the real endpoint instead of a prop nobody ever passed', () => {
    const s = read('src/components/ScansView.tsx');
    expect(s).not.toContain('onBatchTagScans');
    expect(s).toContain("apiFetch('/api/scans/batch-tag', {");
    expect(s).toContain("body: JSON.stringify({ scanIds: selectedScanIds, category: batchCategory.trim() }),");
  });

  it('a failed batch-tag request is shown to the user, not silently swallowed', () => {
    const s = read('src/components/ScansView.tsx');
    expect(s).toContain('setBatchTagError(');
    expect(s).toContain('{batchTagError && ');
  });
});
