/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public registry crawler. Grows the public software registry (/software)
 * by discovering widely-used public GitHub repositories and queueing each
 * one through the exact Free Review path a visitor's review uses -- so every
 * registry page is a real Syft SBOM + OSV + security scan of that
 * repository at a specific commit, never an imported or estimated record.
 *
 * Pace and safety:
 *   - one pass per REGISTRY_CRAWL_INTERVAL_MS (default 1 hour), queueing at
 *     most REGISTRY_CRAWL_BATCH repositories (default 25);
 *   - a pass is skipped entirely when the Free Review queue already holds
 *     more than REGISTRY_CRAWL_MAX_BACKLOG pending/running jobs, so crawler
 *     work never starves a customer's or a visitor's scan;
 *   - discovery walks GitHub's search API by language and star count with a
 *     persistent cursor (registry_crawl_state), so restarts continue rather
 *     than repeat, and it stops cleanly when GitHub rate-limits;
 *   - every pass is recorded in registry_crawl_runs with what was
 *     discovered, queued, skipped and any error, and the founder dashboard
 *     shows those runs as they are.
 *
 * Disable with REGISTRY_CRAWLER_ENABLED=false.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { createWorkerPool } from './worker-db.ts';
import * as schema from '../db/schema.ts';
import { enqueueFreeReview, FREE_REVIEW_TENANT_ID } from '../routes/free-review-submit.ts';

import { CRAWL_LANGUAGES } from '../lib/registryCrawl.ts';
export { CRAWL_LANGUAGES };
const STAR_FLOOR = 500;
const PER_PAGE = 100;
const MAX_PAGE = 10; // GitHub search caps at 1000 results per query.

const int = (value: string | undefined, fallback: number) => { const n = Number.parseInt(value ?? '', 10); return Number.isFinite(n) && n > 0 ? n : fallback; };

export interface CrawlCursor { languageIndex: number; page: number }

export function advanceCursor(cursor: CrawlCursor, resultCount: number): CrawlCursor {
  // Move to the next page; when a page comes back short or the cap is hit,
  // move to the next language and wrap around at the end.
  if (resultCount >= PER_PAGE && cursor.page < MAX_PAGE) return { languageIndex: cursor.languageIndex, page: cursor.page + 1 };
  return { languageIndex: (cursor.languageIndex + 1) % CRAWL_LANGUAGES.length, page: 1 };
}

export const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export async function discoverRepositories(cursor: CrawlCursor, token: string): Promise<{ repositories: Array<{ owner: string; repository: string; stars: number }>; rateLimited: boolean; status: number }> {
  const language = CRAWL_LANGUAGES[cursor.languageIndex] ?? CRAWL_LANGUAGES[0];
  const query = `stars:>=${STAR_FLOOR} language:"${language}" archived:false fork:false`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${PER_PAGE}&page=${cursor.page}`;
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'software-passport-registry-crawler', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (response.status === 403 || response.status === 429) return { repositories: [], rateLimited: true, status: response.status };
  if (!response.ok) throw new Error(`GITHUB_SEARCH_${response.status}`);
  const json: any = await response.json().catch(() => ({}));
  const items: any[] = Array.isArray(json?.items) ? json.items : [];
  const repositories = items
    .map((item) => ({ owner: String(item?.owner?.login ?? ''), repository: String(item?.name ?? ''), stars: Number(item?.stargazers_count ?? 0) }))
    .filter((r) => REPO_NAME.test(r.owner) && REPO_NAME.test(r.repository));
  return { repositories, rateLimited: false, status: response.status };
}

async function withTenant<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [FREE_REVIEW_TENANT_ID]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function runRegistryCrawlerLoop(): Promise<void> {
  const interval = int(process.env.REGISTRY_CRAWL_INTERVAL_MS, 60 * 60 * 1000);
  if (process.env.REGISTRY_CRAWLER_ENABLED === 'false') { await new Promise((r) => setTimeout(r, interval)); return; }
  const batch = int(process.env.REGISTRY_CRAWL_BATCH, 25);
  const maxBacklog = int(process.env.REGISTRY_CRAWL_MAX_BACKLOG, 20);
  const token = process.env.GITHUB_TOKEN?.trim() || '';
  const pool = createWorkerPool();
  const runId = `crawl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let discovered = 0, enqueued = 0, skipped = 0, error: string | null = null, note: string | null = null;
  try {
    await pool.query(`INSERT INTO registry_crawl_runs (id, started_at) VALUES ($1, CURRENT_TIMESTAMP)`, [runId]);
    const backlog = Number((await pool.query(`SELECT count(*)::int AS n FROM agent_jobs WHERE tenant_id=$1 AND job_type='repository_scan' AND status IN ('Pending','Running')`, [FREE_REVIEW_TENANT_ID])).rows[0]?.n ?? 0);
    if (backlog > maxBacklog) {
      note = `skipped: ${backlog} repository scans already pending/running (limit ${maxBacklog})`;
    } else {
      const stateRow = (await pool.query(`SELECT language_index AS "languageIndex", page FROM registry_crawl_state WHERE id = 'default'`)).rows[0];
      let cursor: CrawlCursor = stateRow ? { languageIndex: Number(stateRow.languageIndex), page: Number(stateRow.page) } : { languageIndex: 0, page: 1 };
      const found = await discoverRepositories(cursor, token);
      if (found.rateLimited) {
        note = `github search rate-limited (HTTP ${found.status}); cursor not advanced`;
      } else {
        discovered = found.repositories.length;
        await withTenant(pool, async (client) => {
          const db = drizzle(client, { schema });
          for (const repo of found.repositories) {
            if (enqueued >= batch) break;
            const exists = ((await db.execute(sql`
              SELECT 1 FROM agent_jobs j JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
              WHERE j.tenant_id = ${FREE_REVIEW_TENANT_ID} AND j.job_type = 'repository_scan'
                AND lower(s.repository_owner) = ${repo.owner.toLowerCase()} AND lower(s.repository_name) = ${repo.repository.toLowerCase()} LIMIT 1
            `)) as any).rows?.length;
            if (exists) { skipped += 1; continue; }
            await enqueueFreeReview(db as any, { owner: repo.owner, repository: repo.repository, ref: null, ipHash: `registry-crawler:${runId}` });
            enqueued += 1;
          }
        });
        const next = advanceCursor(cursor, found.repositories.length);
        await pool.query(`INSERT INTO registry_crawl_state (id, language_index, page, updated_at) VALUES ('default', $1, $2, CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET language_index = EXCLUDED.language_index, page = EXCLUDED.page, updated_at = EXCLUDED.updated_at`, [next.languageIndex, next.page]);
        note = `language ${CRAWL_LANGUAGES[cursor.languageIndex]} page ${cursor.page}`;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error('[RegistryCrawler] pass failed:', error);
  } finally {
    await pool.query(`UPDATE registry_crawl_runs SET finished_at = CURRENT_TIMESTAMP, discovered = $2, enqueued = $3, skipped = $4, error = $5, note = $6 WHERE id = $1`, [runId, discovered, enqueued, skipped, error, note]).catch((e) => console.error('[RegistryCrawler] could not record run:', e instanceof Error ? e.message : String(e)));
    await pool.end();
  }
  console.log(`[RegistryCrawler] ${runId}: discovered=${discovered} enqueued=${enqueued} skipped=${skipped}${note ? ` (${note})` : ''}${error ? ` error=${error}` : ''}`);
  await new Promise((r) => setTimeout(r, interval));
}
