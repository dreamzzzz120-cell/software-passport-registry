import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const route = read('src/routes/free-review-legacy.ts');
const view = read('src/components/FreeReviewView.tsx');

// Observed in production: a Free Review whose every engine failed
// (REPOSITORY_REF_NOT_FOUND -- nothing fetched, nothing scanned) was presented
// to the customer as:
//
//   ✓ Review complete (one scan engine did not finish)
//   0 Open findings   0 Critical/High   0 Evidence items
//   "An empty result means no issues were found by these engines"
//
// Every one of those statements was false. A total scan failure was rendered as
// a clean bill of health, which is the precise failure mode SPR exists to
// prevent.
describe('a scan where nothing ran is never presented as a clean result', () => {
  // Originally asserted an `allFailed` flag. That test only caught runs where
  // every job reached status 'Failed', and missed the case production actually
  // hit: a job stuck in 'Pending' forever, which is equally "nothing was
  // scanned" but was never 'Failed'. The contract is restated in terms of what
  // matters -- whether any engine SUCCEEDED -- which covers both. This is
  // strictly stronger than the assertion it replaces.
  it('the API distinguishes total failure from a partial run, by success rather than by failure', () => {
    expect(route).toContain("const succeeded = jobs.filter((j: any) => j.status === 'Completed')");
    // No engine succeeded => 'failed', however the engines got there.
    expect(route).toMatch(/succeeded\.length === 0\s*\?\s*'failed'/);
    // "partial" must still exist for a genuinely mixed run.
    expect(route).toContain("'partial'");
    // A job left unfinished must never be counted toward a clean result.
    expect(route).toContain("const unfinished = jobs.filter((j: any) => ['Pending', 'Running'].includes(j.status))");
    expect(route).toMatch(/anyFailed \|\| unfinished\.length > 0/);
  });

  it('the API returns a customer-safe reason instead of discarding it', () => {
    // The reason was already being SELECTed and thrown away.
    expect(route).toContain('failureReason');
    expect(route).toContain('REPOSITORY_REF_NOT_FOUND');
    expect(route).toContain('REPOSITORY_ACCESS_DENIED');
    // Unrecognized errors must be generalized, never echoed to the customer.
    expect(route).toMatch(/FAILURE_REASONS\[[^\]]+\] \|\|/);
  });

  it('the policy statement itself says zero counts on a failure mean nothing was scanned', () => {
    expect(route).toMatch(/zero counts mean nothing was scanned/i);
  });

  it('the UI never shows a success tick or count tiles for a failed scan', () => {
    const failedBranch = view.slice(view.indexOf("result.scanStatus === 'failed' ? ("), view.indexOf(') : ('));
    expect(failedBranch).toMatch(/couldn&rsquo;t scan this repository/i);
    expect(failedBranch).toContain('role="alert"');
    // No success affordances inside the failure branch.
    expect(failedBranch).not.toContain('CheckCircle2');
    expect(failedBranch).not.toContain('Open findings');
    expect(failedBranch).not.toContain('Evidence items');
    // And it must not invite the customer to claim a passport that does not exist.
    expect(failedBranch).not.toContain('claim this Passport');
    // It must say plainly that this is not a clean result.
    expect(failedBranch).toMatch(/not<\/strong> a clean result|nothing was examined/i);
  });

  it('a partial run is labelled incomplete rather than complete', () => {
    expect(view).toMatch(/Review incomplete/);
    expect(view).toMatch(/incomplete, not as a clean result/i);
  });

  it('the "empty result means no issues were found" line is withheld when nothing ran', () => {
    expect(view).toMatch(/scanStatus === 'failed'[\s\S]{0,200}Nothing was scanned here/);
  });

  it('polling stops on a failed scan rather than spinning forever', () => {
    expect(view).toContain("['complete','partial','failed'].includes(data.scanStatus)");
  });
});
