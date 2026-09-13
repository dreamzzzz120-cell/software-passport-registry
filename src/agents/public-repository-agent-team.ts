/**
 * Autonomous public-repository ingestion team.
 *
 * The team is intentionally deterministic: agents do not invent facts and do
 * not contact repository owners. Discovery finds public repositories; identity
 * normalizes and validates them; quality control rejects unsafe/invalid input;
 * the existing repository/security workers collect evidence and the canonical
 * scoring engine remains the only score writer.
 */
import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { enqueueFreeReview, FREE_REVIEW_TENANT_ID } from '../routes/free-review-submit.ts';

const PROVIDER = 'github';
const AGENT_VERSION = 'public-repository-team/1.0.0';
const DEFAULT_STAR_FLOOR = 50;
const DEFAULT_BATCH = 25;
const DEFAULT_REFRESH_HOURS = 168;
const DEFAULT_MAX_PAGES = 10;
const PER_PAGE = 100;
const MAX_BODY = 32_000;

export type RepositoryCandidate = {
  owner: string;
  repository: string;
  url: string;
  stars: number;
  language: string | null;
  licenseSpdx: string | null;
  defaultBranch: string | null;
  headSha: string | null;
  archived: boolean;
  fork: boolean;
};

export type TeamCursor = { strategyIndex: number; queryIndex: number; page: number; languageIndex: number };

const DEFAULT_QUERIES = [
  'stars:>={STAR} archived:false fork:false',
  'topics:security stars:>={STAR} archived:false fork:false',
  'topics:cybersecurity stars:>={STAR} archived:false fork:false',
  'topics:devtools stars:>={STAR} archived:false fork:false',
  'topics:ai stars:>={STAR} archived:false fork:false',
  'topics:opensource stars:>={STAR} archived:false fork:false',
];

const LANGUAGES = ['JavaScript', 'TypeScript', 'Python', 'Go', 'Java', 'Rust', 'C#', 'Ruby', 'PHP', 'Kotlin', 'Swift', 'C++', 'Scala', 'Dart', 'Elixir'];

function numberEnv(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function configuredQueries() {
  const configured = process.env.REGISTRY_CRAWL_QUERIES?.split('\n').map((q) => q.trim()).filter(Boolean);
  const star = numberEnv('REGISTRY_CRAWL_STAR_FLOOR', DEFAULT_STAR_FLOOR, 1_000_000);
  return (configured?.length ? configured : DEFAULT_QUERIES).map((q) => q.replaceAll('{STAR}', String(star)));
}

function canonicalUrl(owner: string, repository: string) {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

function safeRepoPart(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value);
}

export function normalizeCandidate(item: any): RepositoryCandidate | null {
  const owner = String(item?.owner?.login ?? '');
  const repository = String(item?.name ?? '');
  if (!safeRepoPart(owner) || !safeRepoPart(repository)) return null;
  const url = canonicalUrl(owner, repository);
  return {
    owner,
    repository,
    url,
    stars: Math.max(0, Number(item?.stargazers_count ?? 0) || 0),
    language: typeof item?.language === 'string' ? item.language.slice(0, 80) : null,
    licenseSpdx: typeof item?.license?.spdx_id === 'string' && item.license.spdx_id !== 'NOASSERTION' ? item.license.spdx_id.slice(0, 100) : null,
    defaultBranch: typeof item?.default_branch === 'string' ? item.default_branch.slice(0, 255) : null,
    headSha: typeof item?.pushed_at === 'string' ? item.pushed_at : null,
    archived: item?.archived === true,
    fork: item?.fork === true,
  };
}

export function nextCursor(cursor: TeamCursor, resultCount: number, queryCount: number, languageCount: number): TeamCursor {
  if (resultCount >= PER_PAGE && cursor.page < DEFAULT_MAX_PAGES) return { ...cursor, page: cursor.page + 1 };
  const nextQuery = cursor.queryIndex + 1;
  if (nextQuery < queryCount) return { ...cursor, queryIndex: nextQuery, page: 1 };
  return { strategyIndex: cursor.strategyIndex + 1, queryIndex: 0, page: 1, languageIndex: (cursor.languageIndex + 1) % Math.max(1, languageCount) };
}

async function githubSearch(query: string, page: number, token: string) {
  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', String(page));
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'software-passport-registry-public-repository-team/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 403 || response.status === 429) return { rateLimited: true, status: response.status, items: [] as any[] };
  if (!response.ok) throw new Error(`GITHUB_SEARCH_${response.status}`);
  const json: any = await response.json();
  return { rateLimited: false, status: response.status, items: Array.isArray(json?.items) ? json.items : [] };
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
  } finally {
    client.release();
  }
}

async function getOrCreateConnection(pool: Pool) {
  return withTenant(pool, async (client) => {
    const existing = (await client.query(`SELECT id FROM repository_connections WHERE tenant_id=$1 AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`, [FREE_REVIEW_TENANT_ID])).rows[0];
    if (existing?.id) return String(existing.id);
    const id = `repo_public_${crypto.randomUUID().replaceAll('-', '')}`;
    await client.query(`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES ($1,$2,'github','public-github','Autonomous public GitHub ingestion','public','Active')`, [id, FREE_REVIEW_TENANT_ID]);
    return id;
  });
}

async function queueRefresh(pool: Pool, passportId: string, owner: string, repository: string, connectionId: string) {
  const id = `job_${crypto.randomUUID().replaceAll('-', '')}`;
  const securityId = `job_${crypto.randomUUID().replaceAll('-', '')}`;
  const sourceId = `source_${crypto.randomUUID().replaceAll('-', '')}`;
  const securitySourceId = `source_${crypto.randomUUID().replaceAll('-', '')}`;
  await withTenant(pool, async (client) => {
    await client.query(`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES ($1,$2,'repository-scanner',$3,'repository_scan','Pending',0,NOW(),NOW(),NOW()),($4,$2,'security-scanner',$3,'repository_security_scan','Pending',0,NOW(),NOW(),NOW())`, [id, FREE_REVIEW_TENANT_ID, passportId, securityId]);
    await client.query(`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES ($1,$2,$3,$4,'github',$5,$6,NULL,'',NOW()),($7,$8,$3,$4,'github',$5,$6,NULL,'',NOW())`, [sourceId, id, FREE_REVIEW_TENANT_ID, connectionId, owner, repository, securitySourceId, securityId]);
    await client.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,'repository-scanner','Queued autonomous public-repository refresh for evidence collection.','Info'),($2,'security-scanner','Queued autonomous public-repository security refresh.','Info')`, [id, securityId]);
  });
  return { id, securityId };
}

async function upsertDiscovered(pool: Pool, candidate: RepositoryCandidate) {
  const itemId = `reg_${crypto.createHash('sha256').update(`${PROVIDER}:${candidate.owner.toLowerCase()}/${candidate.repository.toLowerCase()}`).digest('hex').slice(0, 40)}`;
  return withTenant(pool, async (client) => {
    const existing = (await client.query(`SELECT id,passport_id,status,next_refresh_at,head_sha FROM registry_ingestion_items WHERE provider=$1 AND lower(repository_owner)=lower($2) AND lower(repository_name)=lower($3) LIMIT 1`, [PROVIDER, candidate.owner, candidate.repository])).rows[0];
    if (existing) {
      await client.query(`UPDATE registry_ingestion_items SET last_observed_at=CURRENT_TIMESTAMP,stars=$2,language=$3,license_spdx=$4,default_branch=$5,head_sha=$6,updated_at=CURRENT_TIMESTAMP,discovery_agent=$7 WHERE id=$1`, [existing.id, candidate.stars, candidate.language, candidate.licenseSpdx, candidate.defaultBranch, candidate.headSha, AGENT_VERSION]);
      return { ...existing, fresh: false };
    }
    await client.query(`INSERT INTO registry_ingestion_items (id,provider,repository_owner,repository_name,canonical_url,status,discovery_agent,identity_agent,quality_agent,discovered_at,last_observed_at,next_refresh_at,default_branch,head_sha,stars,language,license_spdx,updated_at) VALUES ($1,$2,$3,$4,$5,'discovered',$6,$6,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + ($7 * INTERVAL '1 hour'),$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)`, [itemId, PROVIDER, candidate.owner, candidate.repository, candidate.url, AGENT_VERSION, DEFAULT_REFRESH_HOURS, candidate.defaultBranch, candidate.headSha, candidate.stars, candidate.language, candidate.licenseSpdx]);
    return { id: itemId, passport_id: null, status: 'discovered', next_refresh_at: new Date(0), head_sha: candidate.headSha, fresh: true };
  });
}

async function mark(pool: Pool, id: string, status: string, fields: Record<string, unknown> = {}) {
  const entries = Object.entries(fields);
  const sets = ['status=$2', 'updated_at=CURRENT_TIMESTAMP'];
  const values: unknown[] = [id, status];
  entries.forEach(([key, value], index) => { sets.push(`${key}=$${index + 3}`); values.push(value); });
  await pool.query(`UPDATE registry_ingestion_items SET ${sets.join(', ')} WHERE id=$1`, values);
}

export async function runPublicRepositoryAgentTeamOnce(pool: Pool): Promise<{ discovered: number; queued: number; refreshed: number; quarantined: number; failed: number }> {
  const token = process.env.GITHUB_TOKEN?.trim() ?? '';
  const batch = numberEnv('REGISTRY_CRAWL_BATCH', DEFAULT_BATCH, 500);
  const maxPages = numberEnv('REGISTRY_CRAWL_MAX_PAGES', DEFAULT_MAX_PAGES, 10);
  const refreshHours = numberEnv('REGISTRY_CRAWL_REFRESH_HOURS', DEFAULT_REFRESH_HOURS, 8760);
  const queries = configuredQueries();
  const state = (await pool.query(`SELECT strategy_index AS "strategyIndex",query_index AS "queryIndex",page,language_index AS "languageIndex" FROM registry_crawl_state WHERE id='default'`)).rows[0] as TeamCursor | undefined;
  let cursor: TeamCursor = state ?? { strategyIndex: 0, queryIndex: 0, page: 1, languageIndex: 0 };
  const result = { discovered: 0, queued: 0, refreshed: 0, quarantined: 0, failed: 0 };
  const runId = `crawl_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  await pool.query(`INSERT INTO registry_crawl_runs (id,started_at) VALUES ($1,CURRENT_TIMESTAMP)`, [runId]);
  try {
    const backlog = Number((await pool.query(`SELECT count(*)::int AS n FROM agent_jobs WHERE tenant_id=$1 AND job_type IN ('repository_scan','repository_security_scan') AND status IN ('Pending','Running')`, [FREE_REVIEW_TENANT_ID])).rows[0]?.n ?? 0);
    const maxBacklog = numberEnv('REGISTRY_CRAWL_MAX_BACKLOG', 50, 5000);
    if (backlog > maxBacklog) return result;
    const query = `${queries[cursor.queryIndex] ?? queries[0]} language:${JSON.stringify(LANGUAGES[cursor.languageIndex] ?? LANGUAGES[0])}`;
    const found = await githubSearch(query, cursor.page, token);
    if (found.rateLimited) return result;
    const connectionId = await getOrCreateConnection(pool);
    for (const raw of found.items) {
      if (result.queued >= batch) break;
      const candidate = normalizeCandidate(raw);
      result.discovered += 1;
      if (!candidate || candidate.archived || candidate.fork) { result.quarantined += 1; continue; }
      try {
        const ledger = await upsertDiscovered(pool, candidate);
        const due = !ledger.next_refresh_at || new Date(ledger.next_refresh_at).getTime() <= Date.now();
        if (!ledger.passport_id) {
          const db = drizzle(pool, { schema });
          const queued = await enqueueFreeReview(db as any, { owner: candidate.owner, repository: candidate.repository, ref: null, ipHash: `registry-team:${runId}` });
          await mark(pool, ledger.id, 'queued', { passport_id: queued.passportId, identity_agent: AGENT_VERSION, quality_agent: AGENT_VERSION, next_refresh_at: new Date(Date.now() + refreshHours * 3600_000) });
          result.queued += 1;
        } else if (due) {
          await queueRefresh(pool, String(ledger.passport_id), candidate.owner, candidate.repository, connectionId);
          await mark(pool, ledger.id, 'refresh_queued', { refreshed: true, evidence_agent: AGENT_VERSION, verification_agent: AGENT_VERSION, next_refresh_at: new Date(Date.now() + refreshHours * 3600_000) });
          result.refreshed += 1;
        }
      } catch (error) {
        result.failed += 1;
        await mark(pool, ledgerId(candidate), 'failed', { attempts: sql.raw('attempts + 1') }).catch(() => undefined);
        console.error('[PublicRepositoryTeam] repository failed:', candidate.url, error instanceof Error ? error.message : String(error));
      }
    }
    cursor = { ...nextCursor(cursor, found.items.length, queries.length, LANGUAGES.length), page: Math.min(nextCursor(cursor, found.items.length, queries.length, LANGUAGES.length).page, maxPages) };
    await pool.query(`INSERT INTO registry_crawl_state (id,strategy_index,query_index,page,language_index,updated_at) VALUES ('default',$1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET strategy_index=EXCLUDED.strategy_index,query_index=EXCLUDED.query_index,page=EXCLUDED.page,language_index=EXCLUDED.language_index,updated_at=EXCLUDED.updated_at`, [cursor.strategyIndex, cursor.queryIndex, cursor.page, cursor.languageIndex]);
  } finally {
    await pool.query(`UPDATE registry_crawl_runs SET finished_at=CURRENT_TIMESTAMP,discovered=$2,enqueued=$3,skipped=$4,refreshed=$5,quarantined=$6,failed=$7 WHERE id=$1`, [runId, result.discovered, result.queued, 0, result.refreshed, result.quarantined, result.failed]).catch(() => undefined);
  }
  return result;
}

function ledgerId(candidate: RepositoryCandidate) {
  return `reg_${crypto.createHash('sha256').update(`${PROVIDER}:${candidate.owner.toLowerCase()}/${candidate.repository.toLowerCase()}`).digest('hex').slice(0, 40)}`;
}

export async function runPublicRepositoryAgentTeamLoop() {
  const interval = numberEnv('REGISTRY_CRAWL_INTERVAL_MS', 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
  if (process.env.REGISTRY_CRAWLER_ENABLED === 'false') { await new Promise((resolve) => setTimeout(resolve, interval)); return; }
  const pool = (await import('../workers/worker-db.ts')).createWorkerPool();
  try {
    const result = await runPublicRepositoryAgentTeamOnce(pool);
    if (result.discovered || result.queued || result.refreshed || result.quarantined || result.failed) console.info('[PublicRepositoryTeam]', result);
  } catch (error) {
    console.error('[PublicRepositoryTeam] sweep failed:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
