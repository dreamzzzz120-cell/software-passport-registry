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

const MAX_RESULTS = 100;
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

export function buildMspDiscoveryQueries() {
  return [
    'managed service provider cybersecurity compliance',
    'managed IT services cybersecurity ConnectWise',
    'MSP managed security compliance vendor risk',
    'IT services provider managed clients cybersecurity',
  ];
}

export async function discoverAndQueue(provider: DiscoveryProvider, pool: Pool, queries = buildMspDiscoveryQueries(), limitPerQuery = 25) {
  const results: DiscoveryResult[] = [];
  for (const rawQuery of queries.slice(0, 10)) {
    const query = rawQuery.trim().slice(0, MAX_QUERY);
    if (!query) continue;
    const found = await provider.discover(query, Math.min(MAX_RESULTS, Math.max(1, limitPerQuery)));
    results.push(...found);
  }
  const unique = dedupeDiscoveryResults(results).slice(0, MAX_RESULTS);
  const jobIds: string[] = [];
  for (const result of unique) jobIds.push(await enqueueResearchUrl(pool, result.url));
  return { discovered: unique.length, queued: jobIds.length, results: unique, jobIds, observedAt: new Date().toISOString() };
}
