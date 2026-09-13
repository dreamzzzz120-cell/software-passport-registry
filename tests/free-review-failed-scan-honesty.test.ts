import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const route = read('src/routes/free-review-legacy.ts');
const resultView = read('src/components/FreeReviewResultView.tsx');
const view = read('src/components/FreeReviewView.tsx');

describe('a scan where nothing ran is never presented as a clean result', () => {
  it('the API distinguishes total failure from a partial run by success rather than failure', () => {
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

  it('the failure result explicitly says the review could not be completed', () => {
    expect(resultView).toMatch(/Review could not be completed/i);
    expect(resultView).toMatch(/No evidence was collected/i);
    expect(resultView).toMatch(/No security conclusion should be inferred/i);
    expect(resultView).not.toContain('Open findings');
    expect(resultView).not.toContain('claim this Passport');
  });

  it('a partial result is labelled incomplete rather than complete', () => {
    expect(resultView).toContain('Incomplete evidence');
    expect(resultView).toMatch(/result\.scanStatus === 'partial'/);
  });

  it('the result surface withholds success claims when evidence is absent', () => {
    expect(resultView).toMatch(/No capability is presented as verified without supporting evidence/);
    expect(resultView).toMatch(/UNKNOWN/);
    expect(resultView).toMatch(/observed evidence only/);
  });

  it('the parent view only delegates terminal results to the result surface', () => {
    expect(view).toContain("result && result.scanStatus !== 'scanning'");
    expect(view).toContain('<FreeReviewResultView');
  });

  it('polling stops on a failed scan rather than spinning forever', () => {
    expect(view).toContain("['complete','partial','failed'].includes(data.scanStatus)");
  });
});
