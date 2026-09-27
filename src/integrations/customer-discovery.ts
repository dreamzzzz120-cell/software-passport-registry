import { bearer, safeRequestJson, type ProviderCredentials } from './adapters.ts';
import { withConnectorRetry } from './resilience.ts';

// MSP customer/tenant discovery -- separate from collectProviderEvidence
// (adapters.ts), which answers "is this connection authenticated." This
// answers "which of the MSP's downstream customers does this connection
// manage," so each one can be mapped to an SPR Client. Reuses the same
// SSRF-safe fetch path (safeRequestJson) rather than a second HTTP client.
// Transient vendor failures are retried here; permanent/auth/schema failures
// fail immediately so SPR never silently converts bad data into evidence.

export type DiscoveredCustomer = { externalId: string; name: string; raw: unknown };
export type CustomerDiscoveryResult = {
  customers: DiscoveredCustomer[];
  complete: boolean;
  pagesFetched: number;
  limitation: string | null;
};

const MAX_DISCOVERY_PAGES = 100;
const mapCustomer = (company: any): DiscoveredCustomer => ({
  externalId: String(company.id),
  name: String(company.companyName || company.name || company.identifier || company.id),
  raw: company,
});
export type CustomerDiscoveryProvider = 'connectwise' | 'autotask' | 'ninjaone' | 'hudu';

export const CUSTOMER_DISCOVERY_PROVIDERS: readonly CustomerDiscoveryProvider[] = ['connectwise', 'autotask', 'ninjaone', 'hudu'];

export function supportsCustomerDiscovery(provider: string): provider is CustomerDiscoveryProvider {
  return (CUSTOMER_DISCOVERY_PROVIDERS as readonly string[]).includes(provider);
}

async function resilientRequest(url: string, init: RequestInit) {
  return withConnectorRetry(() => safeRequestJson(url, init));
}

export async function discoverProviderCustomersWithCoverage(provider: CustomerDiscoveryProvider, credentials: ProviderCredentials): Promise<CustomerDiscoveryResult> {
  switch (provider) {
    case 'connectwise': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.companyId || !credentials.publicKey || !credentials.privateKey) throw new Error('CREDENTIAL_MISSING');
      const auth = Buffer.from(`${credentials.companyId}+${credentials.publicKey}:${credentials.privateKey}`).toString('base64');
      const url = `${base}/v4_6_release/apis/3.0/company/companies?pageSize=1000`;
      const { body } = await resilientRequest(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!Array.isArray(body)) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
      return { customers: body.map(mapCustomer), complete: false, pagesFetched: 1, limitation: 'ConnectWise exhaustion was not proven by this collector.' };
    }
    case 'autotask': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.username || !credentials.secret || !credentials.integrationCode) throw new Error('CREDENTIAL_MISSING');
      const headers = { ApiIntegrationCode: credentials.integrationCode, UserName: credentials.username, Secret: credentials.secret, 'Content-Type': 'application/json' };
      let url: string | null = `${base}/v1.0/Companies/query`;
      let init: RequestInit = { method: 'POST', headers, body: JSON.stringify({ filter: [{ op: 'gte', field: 'id', value: 0 }], MaxRecords: 500 }) };
      const customers: DiscoveredCustomer[] = [];
      let pagesFetched = 0;
      while (url && pagesFetched < MAX_DISCOVERY_PAGES) {
        const { body } = await resilientRequest(url, init);
        const items = (body as any)?.items;
        const pageDetails = (body as any)?.pageDetails;
        if (!Array.isArray(items) || !pageDetails || !Object.prototype.hasOwnProperty.call(pageDetails, 'nextPageUrl')) throw new Error('PROVIDER_PAGINATION_UNPROVEN');
        customers.push(...items.map(mapCustomer));
        pagesFetched += 1;
        url = pageDetails.nextPageUrl ? String(pageDetails.nextPageUrl) : null;
        init = { method: 'GET', headers };
      }
      if (url) return { customers, complete: false, pagesFetched, limitation: 'Autotask discovery reached the bounded page limit before exhaustion.' };
      return { customers, complete: true, pagesFetched, limitation: null };
    }
    case 'ninjaone': {
      const base = (credentials.baseUrl || 'https://app.ninjarmm.com').replace(/\/$/, '');
      const url = `${base}/api/v2/organizations`;
      const { body } = await resilientRequest(url, { headers: bearer(credentials) });
      if (!Array.isArray(body)) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
      return { customers: body.map((org: any) => ({ externalId: String(org.id), name: String(org.name || org.id), raw: org })), complete: false, pagesFetched: 1, limitation: 'NinjaOne exhaustion was not proven by this collector.' };
    }
    case 'hudu': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.apiKey) throw new Error('CREDENTIAL_MISSING');
      const customers: DiscoveredCustomer[] = [];
      let pagesFetched = 0;
      for (let page = 1; page <= MAX_DISCOVERY_PAGES; page += 1) {
        const url = `${base}/api/v1/companies?page=${page}`;
        const { body } = await resilientRequest(url, { headers: { 'x-api-key': credentials.apiKey } });
        const companies = Array.isArray(body) ? body : Array.isArray((body as any)?.companies) ? (body as any).companies : null;
        if (!companies) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
        customers.push(...companies.map(mapCustomer));
        pagesFetched += 1;
        if (companies.length < 25) return { customers, complete: true, pagesFetched, limitation: null };
      }
      return { customers, complete: false, pagesFetched, limitation: 'Hudu discovery reached the bounded page limit before exhaustion.' };
    }
  }
}


/**
 * Backward-compatible customer list. Callers that make completeness claims
 * must use discoverProviderCustomersWithCoverage and persist its coverage.
 */
export async function discoverProviderCustomers(provider: CustomerDiscoveryProvider, credentials: ProviderCredentials): Promise<DiscoveredCustomer[]> {
  const result = await discoverProviderCustomersWithCoverage(provider, credentials);
  return result.customers;
}
