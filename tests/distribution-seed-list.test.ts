import { describe, it, expect } from 'vitest';
import { parseSeedUrls, seedListProvider, resolveDiscoveryProvider } from '../src/lib/distribution-discovery.ts';

describe('seed-list discovery provider', () => {
  it('parses newline and comma separated URLs', () => {
    expect(parseSeedUrls('https://a.ca/\n https://b.ca/x , https://c.ca')).toEqual(['https://a.ca/', 'https://b.ca/x', 'https://c.ca']);
    expect(parseSeedUrls(undefined)).toEqual([]);
    expect(parseSeedUrls('  \n ,')).toEqual([]);
  });

  it('accepts large seed batches for high-volume discovery', () => {
    const urls = Array.from({ length: 250 }, (_, i) => `https://msp-${i}.example.com/`).join('\n');
    expect(parseSeedUrls(urls)).toHaveLength(250);
  });

  it('returns home pages, deduped, ignoring the query', async () => {
    const provider = seedListProvider(['https://sfy.ca/services/cybersecurity/', 'https://sfy.ca/', 'https://kcc.ca/managed-it-services', 'ftp://bad.example']);
    const a = await provider.discover('managed IT services Kelowna, BC', 25);
    const b = await provider.discover('anything else', 25);
    expect(a.map((r) => r.url)).toEqual(['https://sfy.ca/', 'https://kcc.ca/']);
    expect(b).toEqual(a);
    expect(a.every((r) => r.source === 'seed-list')).toBe(true);
    expect(await provider.discover('q', 1)).toHaveLength(1);
  });

  it('is used only when no search provider is configured', () => {
    expect(resolveDiscoveryProvider({ DISTRIBUTION_DISCOVERY_SEED_URLS: 'https://sfy.ca/' } as any)?.name).toBe('seed-list');
    expect(resolveDiscoveryProvider({ BRAVE_SEARCH_API_KEY: 'k', DISTRIBUTION_DISCOVERY_SEED_URLS: 'https://sfy.ca/' } as any)?.name).toBe('brave-search');
    expect(resolveDiscoveryProvider({} as any)).toBeNull();
  });
});
