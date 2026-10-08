import { enqueueResearchUrl } from './distribution-engine.ts';
import type { Pool } from 'pg';

export type DiscoveryProvider = {
  name: string;
  discover(query: string, limit: number): Promise<DiscoveryResult[]>;
};

export type DiscoveryResult = {
  url: string;
  title?: string;
  source: string;
  discoveredAt: string;
};

const MAX_RESULTS = 2000;
const MAX_QUERY = 200;

export function canonicalizeDomain(input: string) {
  const parsed = new URL(input);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!hostname || hostname.includes('..')) throw new Error('DISTRIBUTION_INVALID_DOMAIN');
  return hostname;
}

export function dedupeDiscoveryResults(results: DiscoveryResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    try {
      const key = canonicalizeDomain(result.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
}

// Sites that show up in business searches but are never an MSP's own site:
// directories, social networks, review aggregators, code hosts. Researching
// them wastes jobs and, worse, scrapes a directory's info@ as if it were a lead.
const NON_PROSPECT_DOMAINS = [
  'github.com', 'gitlab.com', 'bitbucket.org', 'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'youtube.com', 'reddit.com', 'yelp.com', 'yelp.ca', 'yellowpages.ca', 'yellowpages.com', 'clutch.co', 'goodfirms.co',
  'glassdoor.com', 'glassdoor.ca', 'indeed.com', 'indeed.ca', 'bbb.org', 'crunchbase.com', 'wikipedia.org', 'google.com',
  'bing.com', 'mapquest.com', 'upcity.com', 'designrush.com', 'themanifest.com', 'expertise.com', 'angi.com', 'thumbtack.com',
];

export function isProspectDomain(url: string) {
  try {
    const host = canonicalizeDomain(url);
    return !NON_PROSPECT_DOMAINS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch { return false; }
}

const DEFAULT_LOCATIONS = ['Kelowna, BC', 'Vernon, BC', 'Penticton, BC', 'Kamloops, BC', 'Vancouver, BC', 'Calgary, AB'];

export function discoveryLocations(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.DISTRIBUTION_DISCOVERY_LOCATIONS?.split('\n').map((s) => s.trim()).filter(Boolean);
  return (configured?.length ? configured : DEFAULT_LOCATIONS).slice(0, 20);
}

// Queries describe the business an MSP runs, scoped to a place, so a business
// search returns MSP websites rather than software projects.
export function buildMspDiscoveryQueries(locations = discoveryLocations()) {
  return locations.flatMap((place) => [`managed IT services ${place}`, `managed service provider ${place}`]);
}

async function fetchJson(target: URL | string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(target, { ...init, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json() as any;
  } finally { clearTimeout(timeout); }
}

function toResult(rawUrl: unknown, title: unknown, source: string): DiscoveryResult[] {
  if (typeof rawUrl !== 'string') return [];
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !isProspectDomain(url.toString())) return [];
    // Research the business's home page, not a deep link into it.
    return [{ url: `${url.protocol}//${url.host}/`, title: typeof title === 'string' ? title.slice(0, 500) : undefined, source, discoveredAt: new Date().toISOString() }];
  } catch { return []; }
}

// Google Places Text Search (New): returns actual local businesses with their
// own websiteUri — the best source for "MSPs near Kelowna".
export function googlePlacesProvider(apiKey: string): DiscoveryProvider {
  return { name: 'google-places', async discover(query, limit) {
    const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.displayName,places.websiteUri' },
      body: JSON.stringify({ textQuery: query, pageSize: Math.min(20, Math.max(1, limit)) }),
    }).catch((error) => { throw new Error(`DISTRIBUTION_DISCOVERY_PLACES_${error instanceof Error ? error.message : 'FAILED'}`); });
    const places = Array.isArray(data?.places) ? data.places : [];
    return places.flatMap((place: any) => toResult(place?.websiteUri, place?.displayName?.text, 'google-places'));
  } };
}

// Brave Search web results: broader than Places, good for regions Places covers poorly.
export function braveSearchProvider(apiKey: string): DiscoveryProvider {
  return { name: 'brave-search', async discover(query, limit) {
    const target = new URL('https://api.search.brave.com/res/v1/web/search');
    target.searchParams.set('q', query);
    target.searchParams.set('count', String(Math.min(20, Math.max(1, limit))));
    const data = await fetchJson(target, { headers: { accept: 'application/json', 'X-Subscription-Token': apiKey } })
      .catch((error) => { throw new Error(`DISTRIBUTION_DISCOVERY_BRAVE_${error instanceof Error ? error.message : 'FAILED'}`); });
    const rows = Array.isArray(data?.web?.results) ? data.web.results : [];
    return rows.flatMap((row: any) => toResult(row?.url, row?.title, 'brave-search'));
  } };
}

// Custom endpoint contract: GET ?q=&limit= -> { results: [{ url, title? }] }.
export function httpEndpointProvider(endpoint: string): DiscoveryProvider {
  const parsed = new URL(endpoint);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_DISCOVERY_PROVIDER_SCHEME_NOT_ALLOWED');
  return { name: 'configured-http-provider', async discover(query, limit) {
    const target = new URL(parsed.toString());
    target.searchParams.set('q', query);
    target.searchParams.set('limit', String(limit));
    const data = await fetchJson(target, { headers: { accept: 'application/json', 'user-agent': 'SPR-Distribution-Discovery/1.0 (+https://www.softwarepassportregistry.com)' } })
      .catch((error) => { throw new Error(`DISTRIBUTION_DISCOVERY_PROVIDER_${error instanceof Error ? error.message : 'FAILED'}`); });
    const rows = Array.isArray(data?.results) ? data.results : [];
    return rows.slice(0, limit).flatMap((row: any) => toResult(row?.url, row?.title, 'configured-http-provider'));
  } };
}

// A fixed list of MSP home pages, one per line (or comma-separated), for
// prospects found by hand. Every sweep offers the same list; the sweep skips
// domains already researched and contacts are deduped by email, so nothing
// is researched or emailed twice. Cheapest way to point the engine at a
// known market without a search API.
export function parseSeedUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  return raw.split(/[\n,]/).map((s) => s.trim()).filter((url) => {
    if (!isProspectDomain(url)) return false;
    const domain = canonicalizeDomain(url);
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  }).slice(0, MAX_RESULTS);
}

export function seedListProvider(urls: string[]): DiscoveryProvider {
  const results = dedupeDiscoveryResults(urls.flatMap((url) => toResult(url, undefined, 'seed-list')));
  return { name: 'seed-list', async discover(_query, limit) { return results.slice(0, Math.max(1, limit)); } };
}

// Business-search providers only. There is deliberately no GitHub fallback:
// repository search finds software projects, not MSPs, and every lead it
// produced was noise. No provider configured means no autonomous discovery.
export function resolveDiscoveryProvider(env: NodeJS.ProcessEnv = process.env): DiscoveryProvider | null {
  const places = env.GOOGLE_PLACES_API_KEY?.trim();
  if (places) return googlePlacesProvider(places);
  const brave = env.BRAVE_SEARCH_API_KEY?.trim();
  if (brave) return braveSearchProvider(brave);
  const endpoint = env.DISTRIBUTION_DISCOVERY_PROVIDER_URL?.trim();
  if (endpoint) return httpEndpointProvider(endpoint);
  const seeds = parseSeedUrls([env.DISTRIBUTION_DISCOVERY_SEED_URLS, env.DISTRIBUTION_DISCOVERY_EXTRA_SEED_URLS].filter(Boolean).join('\n'));
  if (seeds.length) return seedListProvider(seeds);
  return null;
}

export async function discoverAndQueue(provider: DiscoveryProvider, pool: Pool, queries = buildMspDiscoveryQueries(), limitPerQuery = 25) {
  const results: DiscoveryResult[] = [];
  const queryByUrl = new Map<string, string>();
  for (const rawQuery of queries.slice(0, 10)) {
    const query = rawQuery.trim().slice(0, MAX_QUERY);
    if (!query) continue;
    const found = await provider.discover(query, Math.min(MAX_RESULTS, Math.max(1, limitPerQuery)));
    for (const item of found) if (!queryByUrl.has(item.url)) queryByUrl.set(item.url, query);
    results.push(...found);
  }
  const unique = dedupeDiscoveryResults(results).slice(0, MAX_RESULTS);
  const jobIds: string[] = [];
  for (const result of unique) jobIds.push(await enqueueResearchUrl(pool, result.url, { kind: 'discovery_sweep', query: queryByUrl.get(result.url) ?? '' }));
  return { discovered: unique.length, queued: jobIds.length, results: unique, jobIds, observedAt: new Date().toISOString() };
}
