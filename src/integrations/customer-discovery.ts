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
export type CustomerDiscoveryProvider = 'connectwise' | 'autotask' | 'ninjaone' | 'hudu';

export const CUSTOMER_DISCOVERY_PROVIDERS: readonly CustomerDiscoveryProvider[] = ['connectwise', 'autotask', 'ninjaone', 'hudu'];

export function supportsCustomerDiscovery(provider: string): provider is CustomerDiscoveryProvider {
  return (CUSTOMER_DISCOVERY_PROVIDERS as readonly string[]).includes(provider);
}

async function resilientRequest(url: string, init: RequestInit) {
  return withConnectorRetry(() => safeRequestJson(url, init));
}

export async function discoverProviderCustomers(provider: CustomerDiscoveryProvider, credentials: ProviderCredentials): Promise<DiscoveredCustomer[]> {
  switch (provider) {
    case 'connectwise': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.companyId || !credentials.publicKey || !credentials.privateKey) throw new Error('CREDENTIAL_MISSING');
      const auth = Buffer.from(`${credentials.companyId}+${credentials.publicKey}:${credentials.privateKey}`).toString('base64');
      const url = `${base}/v4_6_release/apis/3.0/company/companies?pageSize=1000`;
      const { body } = await resilientRequest(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!Array.isArray(body)) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
      return body.map((company: any) => ({ externalId: String(company.id), name: String(company.name || company.identifier || company.id), raw: company }));
    }
    case 'autotask': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.username || !credentials.secret || !credentials.integrationCode) throw new Error('CREDENTIAL_MISSING');
      const url = `${base}/v1.0/Companies/query`;
      const { body } = await resilientRequest(url, {
        method: 'POST',
        headers: { ApiIntegrationCode: credentials.integrationCode, UserName: credentials.username, Secret: credentials.secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: [{ op: 'gte', field: 'id', value: 0 }], MaxRecords: 500 }),
      });
      const items = (body as any)?.items;
      if (!Array.isArray(items)) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
      return items.map((company: any) => ({ externalId: String(company.id), name: String(company.companyName || company.id), raw: company }));
    }
    case 'ninjaone': {
      const base = (credentials.baseUrl || 'https://app.ninjarmm.com').replace(/\/$/, '');
      const url = `${base}/api/v2/organizations`;
      const { body } = await resilientRequest(url, { headers: bearer(credentials) });
      if (!Array.isArray(body)) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
      return body.map((org: any) => ({ externalId: String(org.id), name: String(org.name || org.id), raw: org }));
    }
    case 'hudu': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.apiKey) throw new Error('CREDENTIAL_MISSING');
      const url = `${base}/api/v1/companies?page_size=1000`;
      const { body } = await resilientRequest(url, { headers: { 'x-api-key': credentials.apiKey } });
      const companies = Array.isArray(body) ? body : Array.isArray((body as any)?.companies) ? (body as any).companies : null;
      if (!companies) throw new Error('PROVIDER_RESPONSE_UNEXPECTED_SHAPE');
      return companies.map((company: any) => ({ externalId: String(company.id), name: String(company.name || company.id), raw: company }));
    }
  }
}
