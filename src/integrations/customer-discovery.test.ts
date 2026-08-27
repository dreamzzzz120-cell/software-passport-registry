import { describe, expect, it } from 'vitest';
import { CUSTOMER_DISCOVERY_PROVIDERS, discoverProviderCustomers, supportsCustomerDiscovery } from './customer-discovery.ts';

describe('supportsCustomerDiscovery', () => {
  it('recognizes every provider with a real multi-customer concept', () => {
    for (const provider of CUSTOMER_DISCOVERY_PROVIDERS) expect(supportsCustomerDiscovery(provider)).toBe(true);
  });

  it('rejects single-tenant tools that have no customer concept to discover', () => {
    for (const provider of ['github', 'gitlab', 'slack', 'aws', 'azure', 'microsoft-365', 'jira']) {
      expect(supportsCustomerDiscovery(provider)).toBe(false);
    }
  });

  it('rejects unknown provider strings', () => {
    expect(supportsCustomerDiscovery('not-a-real-provider')).toBe(false);
  });
});

// These validate the credential-completeness checks that run before any
// network call is made -- genuinely unit-testable without live credentials
// or network access, unlike the HTTP calls themselves (which go through the
// SSRF-safe fetch path in adapters.ts and require a real, reachable host).
describe('discoverProviderCustomers credential validation', () => {
  it('rejects a ConnectWise request missing required credential fields before making any request', async () => {
    await expect(discoverProviderCustomers('connectwise', {})).rejects.toThrow('CREDENTIAL_MISSING');
  });

  it('rejects an Autotask request missing required credential fields before making any request', async () => {
    await expect(discoverProviderCustomers('autotask', { baseUrl: 'https://webservices.autotask.net' })).rejects.toThrow('CREDENTIAL_MISSING');
  });

  it('rejects a Hudu request missing required credential fields before making any request', async () => {
    await expect(discoverProviderCustomers('hudu', { baseUrl: 'https://example.huducloud.com' })).rejects.toThrow('CREDENTIAL_MISSING');
  });

  it('rejects a NinjaOne request missing an access token before making any request', async () => {
    await expect(discoverProviderCustomers('ninjaone', {})).rejects.toThrow('CREDENTIAL_MISSING_ACCESS_TOKEN');
  });
});
