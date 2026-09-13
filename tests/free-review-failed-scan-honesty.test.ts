import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const route = read('src/routes/free-review-legacy.ts');
const view = read('src/components/FreeReviewView.tsx');

describe('a scan where nothing ran is never presented as a clean result', () => {
  it('the API distinguishes total failure from a partial run, by success rather than by failure', () => {
    expect(route).toContain("const succeeded = jobs.filter((j: any) => j.status === 'Completed')");
    expect(route).toMatch(/succeeded\.length === 0\s*\?\s*'failed'/);
    expect(route).toContain("'partial'");
    expect(route).toContain("const unfinished = jobs.filter((j: any) => ['Pending', 'Running'].includes(j.status))");
    expect(route).toMatch(/anyFailed \|\| unfinished\.length > 0/);
  });

  it('the API returns a customer-safe reason instead of discarding it', () => {
    expect(route).toContain('failureReason');
    expect(route).toContain('REPOSITORY_REF_NOT_FOUND');
    expect(route).toContain('REPOSITORY_ACCESS_DENIED');
    expect(route).toMatch(/FAILURE_REASONS\[[^\]]+\] \|\|/);
  });

  it('the policy statement itself says zero counts on a failure mean nothing was scanned', () => {
    expect(route).toMatch(/zero counts mean nothing was scanned/i);
  });

  it('the UI never shows a success tick or count tiles for a failed scan', () => {
    const failedBranch = view.slice(view.indexOf("result.scanStatus === 'failed' ? ("), view.indexOf(') : ('));
    expect(failedBranch).toMatch(/We couldn’t scan this repository/i);
    expect(failedBranch).toContain('role="alert"');
    expect(failedBranch).not.toContain('CheckCircle2');
    expect(failedBranch).not.toContain('Open findings');
    expect(failedBranch).not.toContain('Evidence items');
    expect(failedBranch).not.toContain('claim this Passport');
    expect(failedBranch).toMatch(/not a clean result|No evidence was collected/i);
  });

  it('a partial run is labelled incomplete rather than complete', () => {
    expect(view).toMatch(/Review incomplete/);
    expect(view).toMatch(/incomplete|not as a clean result/i);
  });

  it('the failed branch explicitly says that no review was reported', () => {
    const failedBranch = view.slice(view.indexOf("result.scanStatus === 'failed' ? ("), view.indexOf(') : ('));
    expect(failedBranch).toMatch(/No evidence was collected|not obtain enough evidence/i);
  });

  it('polling stops on a terminal scan status', () => {
    expect(view).toContain("['complete', 'partial', 'failed'].includes(data.scanStatus)");
  });
});
