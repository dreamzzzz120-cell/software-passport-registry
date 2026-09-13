import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { advanceCursor, REPO_NAME } from '../src/workers/registry-crawler-worker.ts';
import { CRAWL_LANGUAGES } from '../src/lib/registryCrawl.ts';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('registry crawler discovery cursor', () => {
  it('walks pages within a language, then moves to the next language, then wraps', () => {
    expect(advanceCursor({ languageIndex: 0, page: 1 }, 100)).toEqual({ languageIndex: 0, page: 2 });
    expect(advanceCursor({ languageIndex: 0, page: 3 }, 40)).toEqual({ languageIndex: 1, page: 1 });
    expect(advanceCursor({ languageIndex: 0, page: 10 }, 100)).toEqual({ languageIndex: 1, page: 1 });
    expect(advanceCursor({ languageIndex: CRAWL_LANGUAGES.length - 1, page: 2 }, 0)).toEqual({ languageIndex: 0, page: 1 });
  });

  it('only accepts owner/repository names the registry routes accept', () => {
    expect(REPO_NAME.test('vercel')).toBe(true);
    expect(REPO_NAME.test('next.js')).toBe(true);
    expect(REPO_NAME.test('../etc')).toBe(false);
    expect(REPO_NAME.test('a b')).toBe(false);
  });
});

describe('registry crawler guardrails', () => {
  const worker = read('src/workers/registry-crawler-worker.ts');

  it('feeds the registry only through the real Free Review enqueue path', () => {
    expect(worker).toContain("import { enqueueFreeReview, FREE_REVIEW_TENANT_ID } from '../routes/free-review-submit.ts';");
    expect(worker).toContain('await enqueueFreeReview(db as any, { owner: repo.owner, repository: repo.repository, ref: null');
    expect(worker).not.toMatch(/INSERT INTO passports/);
    expect(worker).not.toMatch(/INSERT INTO scan_findings/);
  });

  it('never starves customer scans and records every pass honestly', () => {
    expect(worker).toContain('if (backlog > maxBacklog)');
    expect(worker).toContain("INSERT INTO registry_crawl_runs (id, started_at)");
    expect(worker).toContain('UPDATE registry_crawl_runs SET finished_at = CURRENT_TIMESTAMP, discovered = $2, enqueued = $3, skipped = $4, error = $5, note = $6');
    expect(worker).toContain("github search rate-limited");
    expect(read('worker.ts')).toContain("supervise('registry-crawler',runRegistryCrawlerLoop)");
  });

  it('the public registry scales: paginated index, total count, direct detail lookup', () => {
    const routes = read('src/routes/software-registry.ts');
    expect(routes).toContain('async function countCompleted(');
    expect(routes).toContain('const entry = (await listCompleted(scopedDb, 1, 0, { owner, repository }))[0];');
    expect(routes).toContain('LIMIT ${limit} OFFSET ${offset}');
    expect(routes).not.toContain('listCompleted(scopedDb, 50000);\n      const entry = entries.find');
  });

  it('the founder dashboard shows the crawler as recorded', () => {
    expect(read('src/routes/founder-command-center.ts')).toContain("router.get('/founder/registry-crawler'");
    expect(read('src/components/FounderDashboardView.tsx')).toContain('<FounderRegistryCrawlerPanel />');
  });
});
