import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildMspDiscoveryQueries, discoveryLocations, isProspectDomain, resolveDiscoveryProvider } from '../src/lib/distribution-discovery.ts';

describe('distribution discovery targets real MSP businesses', () => {
  it('builds location-scoped MSP business queries', () => {
    const queries = buildMspDiscoveryQueries(['Kelowna, BC']);
    expect(queries).toEqual(['managed IT services Kelowna, BC', 'managed service provider Kelowna, BC']);
    expect(discoveryLocations({ DISTRIBUTION_DISCOVERY_LOCATIONS: 'Victoria, BC\nNanaimo, BC' } as any)).toEqual(['Victoria, BC', 'Nanaimo, BC']);
  });

  it('rejects directories, social networks and code hosts as prospects', () => {
    for (const url of ['https://github.com/acme/app', 'https://www.linkedin.com/company/acme', 'https://clutch.co/it-services', 'https://ca.yelp.com/x', 'https://www.yellowpages.ca/bus/1']) {
      expect(isProspectDomain(url), url).toBe(false);
    }
    expect(isProspectDomain('https://www.okanagan-it.ca/')).toBe(true);
  });

  it('picks a business-search provider and never falls back to GitHub', () => {
    expect(resolveDiscoveryProvider({ GOOGLE_PLACES_API_KEY: 'k' } as any)?.name).toBe('google-places');
    expect(resolveDiscoveryProvider({ BRAVE_SEARCH_API_KEY: 'k' } as any)?.name).toBe('brave-search');
    expect(resolveDiscoveryProvider({ DISTRIBUTION_DISCOVERY_PROVIDER_URL: 'https://x.example/search' } as any)?.name).toBe('configured-http-provider');
    expect(resolveDiscoveryProvider({} as any)).toBeNull();
    const worker = fs.readFileSync(new URL('../src/workers/distribution-worker.ts', import.meta.url), 'utf8');
    expect(worker).not.toContain('api.github.com/search/repositories');
  });
});
