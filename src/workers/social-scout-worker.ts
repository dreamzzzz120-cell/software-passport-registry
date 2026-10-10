import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { createWorkerPool } from './worker-db.ts';
import { DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';

// Bounded, read-only public community discovery. Use existing SEO backlog kind,
// with explicit HN evidence source; the content-opportunity schema does not
// accept an arbitrary 'public_discussion' kind. No social posting, DMs,
// profile harvesting, personal email collection, or automatic outreach.
const API = 'https://hn.algolia.com/api/v1/search_by_date';
const QUERIES = [
  'managed service provider',
  'software bill of materials',
  'vendor risk assessment',
  'software supply chain security',
];
const INTERVAL_MS = 60 * 60 * 1000;
const WINDOW_SECONDS = 7 * 24 * 60 * 60;
const SIGNAL = /\b(?:managed service providers?|managed it|msp|sbom|software bill of materials|vendor risk|supply chain security|software supply chain|audit evidence)\b/i;

type HnHit = {
  objectID?: unknown;
  title?: unknown;
  story_title?: unknown;
  comment_text?: unknown;
  created_at_i?: unknown;
};
export type PublicDiscussion = {
  id: string;
  title: string;
  url: string;
  query: string;
  observedAt: string;
  postedAt: string;
  relevanceScore: number;
};

export function discussionFromHit(hit: HnHit, query: string, now = new Date()): PublicDiscussion | null {
  const itemId = typeof hit.objectID === 'string' && /^\d{1,20}$/.test(hit.objectID) ? hit.objectID : null;
  const title = typeof hit.title === 'string' ? hit.title : typeof hit.story_title === 'string' ? hit.story_title : '';
  const text = (title + ' ' + (typeof hit.comment_text === 'string' ? hit.comment_text : '')).slice(0, 4000);
  const posted = typeof hit.created_at_i === 'number' && Number.isFinite(hit.created_at_i) ? hit.created_at_i : NaN;
  if (!itemId || !title.trim() || !SIGNAL.test(text) || !Number.isFinite(posted)) return null;
  if (posted < now.getTime() / 1000 - WINDOW_SECONDS || posted > now.getTime() / 1000 + 300) return null;
  const relevanceScore = Math.min(100,
    (/\b(?:msp|managed service providers?|managed it)\b/i.test(text) ? 35 : 0) +
    (/\b(?:sbom|software bill of materials|software supply chain)\b/i.test(text) ? 35 : 0) +
    (/\b(?:vendor risk|supply chain security|audit evidence)\b/i.test(text) ? 30 : 0)
  );
  if (relevanceScore < 30) return null;
  return {
    id: 'gco_hn_' + createHash('sha256').update('hn:' + itemId).digest('hex').slice(0, 26),
    title: title.trim().slice(0, 240),
    url: 'https://news.ycombinator.com/item?id=' + itemId,
    query,
    observedAt: now.toISOString(),
    postedAt: new Date(posted * 1000).toISOString(),
    relevanceScore,
  };
}

export async function fetchHnDiscussions(query: string, now = new Date()): Promise<PublicDiscussion[]> {
  const url = new URL(API);
  url.searchParams.set('query', query);
  url.searchParams.set('tags', '(story,comment)');
  url.searchParams.set('numericFilters', 'created_at_i>' + Math.floor(now.getTime() / 1000 - WINDOW_SECONDS));
  url.searchParams.set('hitsPerPage', '20');
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'SPR-Social-Scout/1.0 (+https://softwarepassportregistry.com)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('SOCIAL_SCOUT_SOURCE_HTTP_' + response.status);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 250_000) throw new Error('SOCIAL_SCOUT_SOURCE_TOO_LARGE');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('hits' in data) || !Array.isArray(data.hits)) {
    throw new Error('SOCIAL_SCOUT_SOURCE_SCHEMA_INVALID');
  }
  return data.hits.slice(0, 20).map((hit: HnHit) => discussionFromHit(hit, query, now)).filter((hit: PublicDiscussion | null): hit is PublicDiscussion => hit !== null);
}

export async function persistDiscussions(pool: Pool, discussions: PublicDiscussion[]): Promise<number> {
  if (discussions.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [DISTRIBUTION_TENANT_ID]);
    let inserted = 0;
    for (const item of discussions) {
      const evidence = JSON.stringify([{
        provider: 'hacker-news-algolia',
        publicDiscussionUrl: item.url,
        query: item.query,
        postedAt: item.postedAt,
        observedAt: item.observedAt,
        relevanceScore: item.relevanceScore,
        limitations: 'Relevance is heuristic. No buying intent, consent or individual identity is inferred.',
      }]);
      const result = await client.query(
        "INSERT INTO growth_content_opportunities (id,tenant_id,kind,topic,source_evidence,status) VALUES ($1,$2,'seo',$3,$4,'backlog') ON CONFLICT (id) DO NOTHING",
        [item.id, DISTRIBUTION_TENANT_ID, item.title, evidence]
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runSocialScoutWorkerLoop() {
  const pool = createWorkerPool();
  try {
    while (true) {
      let found = 0;
      let persisted = 0;
      for (const query of QUERIES) {
        try {
          const rows = await fetchHnDiscussions(query);
          found += rows.length;
          persisted += await persistDiscussions(pool, rows);
        } catch (error) {
          console.error('[SocialScout] source query failed:', query, error instanceof Error ? error.message : String(error));
        }
      }
      console.info('[SocialScout] sweep', JSON.stringify({ source: 'hacker-news', found, persisted, mode: 'read-only-review' }));
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  } finally {
    await pool.end();
  }
}
